// Which TCGplayer product (tcgcsv category 68) each One Piece row IS, and the printings TCGplayer sells that no row
// is (scripts/sync-onepiece-tcg.mjs, 10-25, Chris: every printing TCGplayer sells gets its own row and price).
// The picture picker (lib/onepiecePick.mjs) pairs by price first and records nothing, so on 10-25 2,875 card products
// were tied to no row: 813 rows of ours named a product's printing and showed none (Rebecca OP05-091 October
// Championship 2024 Online Regional, TCGplayer $8,000, our row unpriced) and ~1,900 printings had no row at all
// (pre-release / release event / anniversary stamps, 393 promos, LT-01 decks). Here the product's printing TAGS decide
// ("(Alternate Art)", "(SP) (Gold)", "(Offline Regional 2024 Vol. 3) [Finalist]"); price never does.
// Pure: rows from tcg_cards, groups + products from tcgcsv; scripts/test-onepiece-tie.mjs holds the measured cases.
import { onePieceProductPrice } from "../../src/lib/onepiece.ts";

export const slug = (s) => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// "(OP05-119)", "(091)": numbering, not a printing.
const CARD_NO = /^(?:[A-Z]{1,4}\d{0,3}-\d{2,4}|\d{3})$/;
// A card product's Number (sealed products, DON!! cards and "1/1000" certificates have none of this shape).
export const NUMBER = /^[A-Z]{1,4}\d{0,3}-\d{1,4}$/;
export const tcgImage = (productId) => `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`;
// A row tied to its product carries the product in its picture link (clean TCGplayer scans) or in tcg_product_id.
export const pictureProduct = (row) => {
  for (const u of [row.own_image_src, row.image_url]) {
    const m = /tcgplayer-cdn\.tcgplayer\.com\/product\/(\d+)_/.exec(u ?? "");
    if (m) return Number(m[1]);
  }
  return null;
};
// Rows this pass added: the product is in the id ("OP17-006#tcg712668"), never renumbered.
export const addedProduct = (id) => Number(/#tcg(\d+)$/.exec(id)?.[1] ?? 0) || null;

/** "Roronoa Zoro - OP06-118 (Alternate Art) [Winner]" -> { base: "Roronoa Zoro", tags: ["Alternate Art", "Winner"] }. Top-level groups only: "(Beginners Deck Party [ST-23] - [ST-28] Winner Pack)" is one tag. */
export function parseName(name) {
  const s = String(name ?? "").replace(/ - (?:[A-Z]{1,4}\d{0,3}-\d{2,4})(?=\s|$)/, "");
  const tags = [];
  let base = "", cur = "", depth = 0, open = "";
  for (const ch of s) {
    if (depth === 0 && (ch === "(" || ch === "[")) { depth = 1; open = ch; cur = ""; continue; }
    if (depth > 0) {
      if (ch === open) depth++;
      else if ((open === "(" && ch === ")") || (open === "[" && ch === "]")) {
        if (--depth === 0) { tags.push(cur.trim()); continue; }
      }
      cur += ch;
      continue;
    }
    base += ch;
  }
  return { base: base.replace(/\s+/g, " ").trim(), tags: tags.filter((t) => t && !CARD_NO.test(t)) };
}

const TAG_KEY = { "alternate-art": "alt-art", "super-alternate-art": "super-alt-art", "red-super-alternate-art": "red-super-alt-art", "super-leader-alternate-art": "super-leader-alt-art" };
const tagKey = (t) => { const k = slug(t); return TAG_KEY[k] ?? k; };
// Our feed's words for the same printings (sync-onepiece.mjs splitVariant).
const ROW_KEY = { special: "sp", spr: "sp" };
// TCGplayer's key -> the variant an added row carries (the feed's vocabulary where it has a word).
const ADD_VARIANT = { sp: "special" };
/** OP06-118 -> OP06, ST10-001 -> ST10, P-001 -> P: the set a card number was first printed in. */
export const homeCode = (number) => number.replace(/-\d+$/, "").replace(/-/g, "");

/**
 * One tcgcsv group as CardFlip files it. code = our set_code ("ST-01" -> "ST01", "OP15-EB04" -> "OP15EB04").
 * stamp = the event groups (lib/onepiece.ts isOnePieceStampedTwin): "OP08 PRE" pre-release, "OP17 RE" release event,
 * "OP05 ANN" anniversary, "ST-01 PRE" super pre-release; they file under their booster (parent).
 */
export function groupInfo(groups) {
  const out = new Map();
  const plain = groups.filter((g) => !/\s(PRE|RE|ANN)$/.test(String(g.abbreviation ?? "")));
  for (const g of groups) {
    const ab = String(g.abbreviation ?? "").trim();
    const m = /^(\S+)\s+(PRE|RE|ANN)$/.exec(ab);
    const info = { groupId: g.groupId, name: String(g.name ?? ""), abbreviation: ab, day: String(g.publishedOn ?? "").slice(0, 10), code: ab.replace(/[-\s]/g, "").toUpperCase(), stamp: null, parent: null, promo: ab === "OP-PR" };
    if (m) {
      info.stamp = m[2] === "PRE" ? (/^ST-?\d/.test(m[1]) ? "super-pre-release" : "pre-release") : m[2] === "RE" ? "release-event" : "anniversary";
      // "Two Legends Pre-Release Cards" files under "Two Legends"; "OP15 RE" under "OP15-EB04" (same name, the code differs).
      const parent = plain.filter((p) => info.name.startsWith(String(p.name ?? "")) && p.name).sort((a, b) => b.name.length - a.name.length)[0];
      info.parent = parent ? String(parent.abbreviation).replace(/[-\s]/g, "").toUpperCase() : m[1].replace(/-/g, "").toUpperCase();
    }
    out.set(g.groupId, info);
  }
  return out;
}

/** A product's printing key, as our rows would name it: its tags minus the ones that only say "reprint" / which deck of a deck set (LT-01, SD01 "(Luffy Deck)"). */
export function productKeys(product, group) {
  const reprint = group.code !== homeCode(product.number);
  let k = parseName(product.name).tags
    .filter((t) => !(reprint && / Deck$/i.test(t)))
    .map(tagKey)
    .filter((x) => !(x === "reprint" && reprint));
  // "(Parallel) (Manga)" / "(Alternate Art) (Manga)" are the manga printing; "(SP) (Gold)" is the gold one.
  if (k.includes("manga")) k = k.filter((x) => x !== "parallel" && x !== "alt-art");
  if (k.some((x) => x === "gold" || x === "silver" || x === "wanted-poster")) k = k.filter((x) => x !== "sp");
  return [...new Set(k)].sort().join("+");
}

/** A row's printing key: a promo's tags ride in its name ("Tony Tony.Chopper (Offline Regional 2024 Vol. 3) [Finalist]") or its variant slug. */
export function rowKeys(row) {
  if (/#promo/.test(row.id)) {
    const { tags } = parseName(row.name);
    if (tags.length) return [...new Set(tags.map(tagKey))].sort().join("+");
    const v = slug(row.variant);
    return !v || /^promo(-pr\d+)?$/.test(v) ? "" : v;
  }
  const v = slug(row.variant);
  if (!v || CARD_NO.test(String(row.variant).toUpperCase())) return "";
  if (v === "reprint") return row.set_code !== homeCode(row.collector_number) ? "" : "reprint";
  return ROW_KEY[v] ?? v;
}

/**
 * rows: tcg_cards One Piece rows (id, name, collector_number, variant, set_code, image_url, own_image_src,
 * tcg_product_id?); products: { productId, groupId, name, number } card products only.
 * Returns ties (row id -> { productId, how }), the products tied (product id -> row id) and the rows left untied.
 * how: "added" (a row this pass made), "kept" (its recorded / picture product), "moved" (its picture was another set's
 * card or a plain card under a promo), "linked" (it had none).
 */
export function tieRows(rows, products, groups) {
  const info = groupInfo(groups);
  const prodById = new Map(products.map((p) => [p.productId, p]));
  const byNumber = new Map();
  for (const p of products) byNumber.set(p.number, [...(byNumber.get(p.number) ?? []), p]);
  const code = (p) => info.get(p.groupId)?.code ?? "";
  const stamped = (p) => Boolean(info.get(p.groupId)?.stamp);
  const keysOf = new Map(products.map((p) => [p.productId, info.has(p.groupId) ? productKeys(p, info.get(p.groupId)) : "?"]));
  const keys = (p) => keysOf.get(p.productId);

  // Pass 1: each row's own product by tags, beside the product it shows today.
  const seen = rows.map((r) => {
    const own = addedProduct(r.id);
    const cur = own ?? (r.tcg_product_id || null) ?? pictureProduct(r);
    const all = byNumber.get(r.collector_number) ?? [];
    const inSet = all.filter((p) => code(p) === r.set_code);
    // No product in the row's own set: any group but the stamped ones, and never the original when the row is a reprint.
    let pool = inSet.length ? inSet : all.filter((p) => !stamped(p));
    if (!inSet.length && r.set_code !== homeCode(r.collector_number) && !/#promo/.test(r.id)) pool = pool.filter((p) => code(p) !== homeCode(r.collector_number));
    const want = rowKeys(r);
    let hits = pool.filter((p) => keys(p) === want);
    const exact = hits.length === 1;
    // The feed says "alt-art" for TCGplayer's Super / Red Super / Super Leader Alternate Art when the set prints no plain one.
    if (!hits.length && want === "alt-art") hits = pool.filter((p) => /^(red-)?super-(leader-)?alt-art$/.test(keys(p)));
    // ... and "alt-art" for the manga when the set has no other alt art (Shanks OP01-120_p2 $1,532.80 = TCGplayer's
    // "Shanks (Parallel) (Manga) (Alternate Art)"; adding that product as its own row would have listed him twice).
    if (!hits.length && want === "alt-art" && !pool.some((p) => /alt-art/.test(keys(p)))) hits = pool.filter((p) => keys(p) === "manga");
    // PRB-01: the feed's plain "reprint" row is the Jolly Roger Foil printing (29 of 29 priced rows sat closest to it, 10-25).
    if (!hits.length && !want && r.set_code === "PRB01") hits = pool.filter((p) => keys(p) === "jolly-roger-foil");
    // A promo whose TCGplayer name carries one more tag ("(Illustration Box Vol.2) (Textured)").
    if (!hits.length && want && /#promo/.test(r.id)) hits = pool.filter((p) => want.split("+").every((k) => keys(p).split("+").includes(k)));
    // The row's set lists one product for the number and our variant word is not TCGplayer's ("parallel" in ST-31).
    if (!hits.length && inSet.length === 1) hits = inSet;
    return { r, own, cur, want, inSet: inSet.length > 0, exact, cand: hits.length === 1 ? hits[0].productId : null, hits: hits.length };
  });

  // Pass 2: a product today's pass already shows stays, unless the tags say the row is clearly another product.
  const ties = new Map();
  for (const x of seen) {
    if (x.own) { ties.set(x.r.id, { productId: x.own, how: "added" }); continue; }
    if (!x.cur) continue;
    let productId = x.cur, how = "kept";
    const curP = prodById.get(x.cur);
    if (x.cand && x.exact && x.cand !== x.cur) {
      const candP = prodById.get(x.cand);
      const wrongSet = curP && x.inSet && code(curP) !== x.r.set_code && code(candP) === x.r.set_code;
      const plainForPromo = curP && /#promo/.test(x.r.id) && x.want && keys(curP) === "" && code(curP) !== "OPPR";
      if (wrongSet || plainForPromo) { productId = x.cand; how = "moved"; }
    }
    ties.set(x.r.id, { productId, how });
  }
  // Two rows on one product: the one outside the product's set takes its own set's product when nobody has it.
  const holders = new Map();
  for (const [id, t] of ties) holders.set(t.productId, [...(holders.get(t.productId) ?? []), id]);
  const used = new Set([...ties.values()].map((t) => t.productId));
  const byId = new Map(seen.map((x) => [x.r.id, x]));
  for (const [pid, ids] of holders) {
    if (ids.length < 2 || !prodById.has(pid)) continue;
    for (const id of ids) {
      const x = byId.get(id);
      // Only on its tags exactly: a fallback pick (PRB-01 "reprint" -> Jolly Roger Foil) would take a product another row names outright.
      if (x.own || code(prodById.get(pid)) === x.r.set_code || !x.cand || !x.exact || used.has(x.cand) || code(prodById.get(x.cand)) !== x.r.set_code) continue;
      ties.set(id, { productId: x.cand, how: "moved" });
      used.add(x.cand);
    }
  }
  const claimed = new Map();
  const shared = [];
  for (const [id, t] of ties) {
    if (claimed.has(t.productId)) shared.push({ id, with: claimed.get(t.productId), productId: t.productId });
    else claimed.set(t.productId, id);
  }
  // Rows with no product yet: their tag match, when no other row holds it (an exact match beats a fallback, then the own set).
  const wants = new Map();
  for (const x of seen) if (!ties.has(x.r.id) && x.cand && !claimed.has(x.cand)) wants.set(x.cand, [...(wants.get(x.cand) ?? []), x]);
  const clashes = [];
  for (const [pid, xs] of wants) {
    const exact = xs.filter((x) => x.exact);
    const ownSet = xs.filter((x) => code(prodById.get(pid)) === x.r.set_code);
    const pick = xs.length === 1 ? xs[0] : exact.length === 1 ? exact[0] : ownSet.length === 1 ? ownSet[0] : null;
    if (!pick) { clashes.push({ productId: pid, rows: xs.map((x) => x.r.id) }); continue; }
    ties.set(pick.r.id, { productId: pid, how: "linked" });
    claimed.set(pid, pick.r.id);
  }
  const untied = seen.filter((x) => !ties.has(x.r.id)).map((x) => ({ id: x.r.id, set_code: x.r.set_code, collector_number: x.r.collector_number, variant: x.r.variant, want: x.want, hits: x.hits }));
  return { ties, claimed, shared, clashes, untied, info };
}

/**
 * The rows to add: card products no row holds, in a released group, with a price (onePieceProductPrice). Their id
 * carries the product ("OP17-006#tcg712668": never reused, never renumbered, no page, lib/cardPages KEY_PATTERN).
 * sets: set_code -> { name, day } as our rows have them. today: YYYY-MM-DD.
 * Event stamps file under their booster with the stamp as the variant, promos under PROMO, everything else under its
 * own group's code ("LT01" Learn Together Deck Set, "PRB02" ...).
 */
export function rowsToAdd(products, info, claimed, prices, sets, today, untied = [], now = Date.now()) {
  const out = [];
  const skipped = { unreleased: 0, noPrice: 0, badNumber: 0, maybeOurs: 0 };
  // A row of ours the tags could not tie, same number in the product's own set: likely that very printing under the
  // feed's word for it. It is left for a look (maybe), never added beside it.
  const loose = new Set(untied.map((u) => `${u.set_code}|${u.collector_number}`));
  const maybe = [];
  for (const p of products) {
    if (claimed.has(p.productId)) continue;
    const g = info.get(p.groupId);
    if (!g) continue;
    if (!NUMBER.test(p.number)) { skipped.badNumber++; continue; }
    if (!g.day || g.day > today) { skipped.unreleased++; continue; }
    const usd = prices.get(p.productId) ?? null;
    if (usd == null) { skipped.noPrice++; continue; }
    const k = productKeys(p, g).replace(/\+/g, "-");
    const setCode = g.promo ? "PROMO" : g.stamp ? g.parent : g.code;
    if (!g.stamp && loose.has(`${setCode}|${p.number}`)) { skipped.maybeOurs++; maybe.push({ productId: p.productId, name: p.name, group: g.abbreviation, number: p.number, usd }); continue; }
    const known = sets.get(setCode);
    const parentDay = g.stamp ? [...info.values()].find((x) => x.code === g.parent)?.day : null;
    const variant = g.stamp
      ? `${g.stamp}${k ? `-${k}` : ""}`
      : g.promo
        ? k || "promo"
        : ADD_VARIANT[k] ?? (k || (g.code === homeCode(p.number) ? "" : "reprint"));
    out.push({
      id: `${p.number}#tcg${p.productId}`,
      game: "onepiece",
      name: parseName(p.name).base || p.name,
      subtitle: "",
      set_code: setCode,
      set_name: g.promo ? "One Piece Promotion Cards" : known?.name ?? (g.stamp ? g.name : g.name.replace(/^ST-\d+:\s*/, "")),
      collector_number: p.number,
      set_total: null,
      // A stamp keeps its booster's date: the set list's "Newest first" sorts by the earliest date of a set.
      set_release_date: g.promo ? "" : known?.day || parentDay || g.day,
      rarity: p.rarity ?? "",
      variant,
      image_url: tcgImage(p.productId),
      price_usd: usd,
      price_usd_foil: null,
      art_hash: "",
      synced_at: now,
      ref_image_url: "",
      tcg_product_id: p.productId,
    });
  }
  return { rows: out, skipped, maybe };
}

/** tcgcsv /prices rows -> product id -> CardFlip's price (lib/onepiece.ts onePieceProductPrice). */
export function productPrices(priceRows) {
  const byProduct = new Map();
  for (const r of priceRows) byProduct.set(r.productId, [...(byProduct.get(r.productId) ?? []), r]);
  const out = new Map();
  for (const [pid, list] of byProduct) out.set(pid, onePieceProductPrice(list));
  return out;
}
