// One Piece Card Game mirror from optcgapi.com (free, no key; the author
// asks for a light touch, so this is three bulk calls, not one per card):
// booster sets, starter decks, promos. Market prices refresh daily there.
// Writes tcg_cards rows with game = 'onepiece' (docs/NEW-GAMES.md).
//
//   npm run sync:onepiece
//
// Printed key: the card id "OP01-077" (set code + number in one token) sits
// bottom-left on every card. Alternate arts / parallels / box toppers are
// separate entries whose card_image_id carries a suffix and whose name
// carries "(Parallel)" etc. — the variant column keeps that so the picture
// tiebreak can pick the price line.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const API = "https://optcgapi.com/api";
const HEADERS = { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)", Accept: "application/json" };
const db = new DatabaseSync(process.env.CARDFLIP_DB_PATH ?? path.join(process.cwd(), "data", "cardflip.db"));
db.exec(`CREATE TABLE IF NOT EXISTS tcg_cards (
  id TEXT PRIMARY KEY, game TEXT NOT NULL, name TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '',
  set_code TEXT NOT NULL, set_name TEXT NOT NULL, collector_number TEXT NOT NULL, set_total INTEGER,
  set_release_date TEXT NOT NULL DEFAULT '', rarity TEXT NOT NULL DEFAULT '', variant TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '', price_usd REAL, price_usd_foil REAL, art_hash TEXT NOT NULL DEFAULT '',
  synced_at INTEGER NOT NULL)`);
// ref_image_url (09-30): Bandai's card-list art, "SAMPLE" stamp and all —
// never shown, only fetched server-side by the picture tiebreak (vision.ts
// catalogPicture). image_url is what people see: a clean TCGplayer scan
// from sync-onepiece-images.mjs, or nothing.
if (!db.prepare("PRAGMA table_info(tcg_cards)").all().some((c) => c.name === "ref_image_url")) db.exec("ALTER TABLE tcg_cards ADD COLUMN ref_image_url TEXT NOT NULL DEFAULT ''");

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

// image_url is never written here: a new row starts empty and the images
// pass (sync-onepiece-images.mjs, same npm script) gives it a clean scan
// when TCGplayer has one; an existing row keeps what that pass decided.
const upsert = db.prepare(`INSERT INTO tcg_cards (id, game, name, subtitle, set_code, set_name, collector_number, set_total, set_release_date, rarity, variant, image_url, ref_image_url, price_usd, price_usd_foil, synced_at)
  VALUES (?, 'onepiece', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, subtitle = excluded.subtitle, set_code = excluded.set_code, set_name = excluded.set_name,
    collector_number = excluded.collector_number, set_total = excluded.set_total, rarity = excluded.rarity, variant = excluded.variant,
    ref_image_url = excluded.ref_image_url, price_usd = excluded.price_usd, price_usd_foil = excluded.price_usd_foil, synced_at = excluded.synced_at`);

// "Perona (Parallel)" → variant "parallel"; "(Box Topper)" → "box-topper";
// "(Alternate Art)" / "(Alt Art)" → "alt-art"; "(Manga)" → "manga";
// "(Card Number)" wrappers and other tags → the tag folded.
function splitVariant(name) {
  let rest = (name ?? "").trim();
  let variant = "";
  // Peel every trailing "(…)" tag: "(001)" is the feed's card-number tag
  // (dropped), the rest name a printing.
  for (;;) {
    const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(rest);
    if (!m) break;
    rest = m[1].trim();
    const tag = m[2].toLowerCase().trim();
    if (/^\d+$/.test(tag)) continue;
    const v = /parallel/.test(tag) ? "parallel"
      : /box topper/.test(tag) ? "box-topper"
      : /alt/.test(tag) ? "alt-art"
      : /manga/.test(tag) ? "manga"
      : /reprint/.test(tag) ? "reprint"
      : /sp\b|special/.test(tag) ? "special"
      : tag.replace(/[^a-z0-9]+/g, "-");
    if (!variant) variant = v;
  }
  // Some feed names carry the card number: "Roronoa Zoro - OP10-095".
  rest = rest.replace(/\s+-\s+[A-Z]+\d*-\d+[a-z0-9_#]*$/i, "").trim();
  return { name: rest, variant };
}

// Promos (10-01): the feed "allPromos" (allPromoCards 404s since 09-30) —
// event packs, judge packs, winner stamps, P-0xx. One group there, "One
// Piece Promotion Cards", ~1,080 entries; two thirds are a promo printing of
// a regular number (OP09-077 Premium Card Collection, $32 against cents).
//   - set_code PROMO for all of them (the feed's set_id is the card's own
//     prefix: 39 codes would be 39 "Promotion Cards" sets in By set);
//   - id "<card_image_id>#promo": the image id is unique inside the promo
//     feed, half of them equal a regular card's id, and this id must not
//     depend on what the other two feeds hold (the positional "#n" above
//     does). The daily price refresh matches on id-before-# + set name
//     (tcgPriceRefresh planTcgRefresh) and finds these rows as they are;
//   - the picture is the feed's own (SAMPLE-stamped, like most regular
//     rows): several untagged promos of one number are told apart only by
//     it in "Which printing is yours?". The images pass skips set_code
//     PROMO — its TCGplayer pairing gave promos other cards' scans.
// --with-promos turns the feed on; without it promo rows are left as they are.
const PROMO_SET_CODE = "PROMO";
const promoPicture = db.prepare("UPDATE tcg_cards SET image_url = ? WHERE id = ?");
function promoVariant(cardName, imageId, key) {
  const { variant } = splitVariant(cardName);
  if (variant) return variant.replace(/^-+|-+$/g, "");
  // No tag in the name: the image-id suffix tells two apart ("P-006_pr2").
  const suffix = imageId !== key ? imageId.slice(key.length).replace(/^[_-]+/, "").toLowerCase() : "";
  return suffix ? `promo-${suffix}` : "promo";
}

// A feed that answers 200 with a fraction of its cards must not pass for a sync.
const FEEDS = [
  ["sets", `${API}/allSetCards/`, 3000],
  ["starter decks", `${API}/allSTCards/`, 500],
  ...(process.argv.includes("--with-promos") ? [["promos", `${API}/allPromos/`, 800]] : []),
];
const now = Date.now();
let total = 0;
let failedFeeds = 0;
const seenIds = new Set();
for (const [label, url, floor] of FEEDS) {
  let rows;
  try {
    rows = await getJson(url);
    rows = Array.isArray(rows) ? rows : rows.results ?? rows.data ?? [];
    if (rows.length < floor) throw new Error(`${rows.length} entries, expected at least ${floor}`);
  } catch (err) {
    console.log(`  !! ${label}: ${err.message}`);
    failedFeeds++;
    continue;
  }
  const promo = label === "promos";
  db.exec("BEGIN");
  for (const c of rows) {
    const key = String(c.card_set_id ?? "").trim(); // OP01-077
    if (!key) continue;
    const imageId = String(c.card_image_id ?? key);
    if (promo) {
      upsert.run(
        `${imageId}#promo`,
        splitVariant(c.card_name).name,
        "",
        PROMO_SET_CODE,
        String(c.set_name ?? "One Piece Promotion Cards"),
        key.replace(/_[rp]\d+$/i, ""),
        null,
        "",
        String(c.rarity ?? ""),
        promoVariant(c.card_name, imageId, key),
        String(c.card_image ?? ""),
        String(c.card_image ?? ""),
        c.market_price != null ? Number(c.market_price) : null,
        null,
        now,
      );
      // The upsert leaves image_url alone on a conflict (the images pass owns it for regular rows).
      promoPicture.run(String(c.card_image ?? ""), `${imageId}#promo`);
      total++;
      continue;
    }
    const { name, variant: nameVariant } = splitVariant(c.card_name);
    // Two rows can share card_set_id (base + parallel); the image id is unique.
    let id = `${imageId}`;
    if (seenIds.has(id)) id = `${imageId}#${seenIds.size}`;
    seenIds.add(id);
    // Image-id suffixes: "_p1" / "_p2" are parallels (alternate art), "_r1" a reprint.
    const suffix = imageId !== key ? imageId.slice(key.length).replace(/^[_-]+/, "").toLowerCase() : "";
    const variant = nameVariant || (/^p\d/.test(suffix) ? "parallel" : /^r\d/.test(suffix) ? "reprint" : suffix);
    const setCode = String(c.set_id ?? key.split("-")[0]).replace("-", ""); // "OP-01" → "OP01"
    // The feed occasionally attaches another card's picture (ST36 Basil
    // Hawkins carried OP10-103_r1 = Bege). A picture of the wrong card is
    // worse than none: the scanner would show it and the tiebreak would
    // compare against it. Blank it when the filename names a different number.
    let image = String(c.card_image ?? "");
    const fileNum = /^([A-Z]{1,4}\d{0,3}-\d{1,4})/i.exec(image.split("/").pop() ?? "");
    if (fileNum && fileNum[1].toUpperCase() !== key.replace(/_[rp]\d+$/i, "").toUpperCase()) { console.log(`  wrong picture dropped: ${id} ${name} → ${image.split("/").pop()}`); image = ""; }
    upsert.run(
      id,
      name,
      "",
      setCode,
      String(c.set_name ?? ""),
      key.replace(/_[rp]\d+$/i, ""), // the feed keys a few reprints "P-029_r1"; the face says P-029
      null,
      "",
      String(c.rarity ?? ""),
      variant,
      "", // shown picture: the images pass fills it with a clean scan, or leaves it empty
      image, // reference picture for the tiebreak (stamped is fine there)
      c.market_price != null ? Number(c.market_price) : null,
      null,
      now,
    );
    total++;
  }
  db.exec("COMMIT");
  console.log(`  ${label}: ${rows.length} entries`);
}
const n = db.prepare("SELECT COUNT(*) AS n FROM tcg_cards WHERE game = 'onepiece'").get().n;
const variants = db.prepare("SELECT variant, COUNT(*) AS n FROM tcg_cards WHERE game = 'onepiece' GROUP BY variant ORDER BY n DESC LIMIT 8").all();
console.log(`onepiece: ${total} entries written, ${n} rows in the mirror; variants: ${variants.map((v) => `${v.variant || "base"}=${v.n}`).join(", ")}`);
if (failedFeeds) { console.log(`onepiece: ${failedFeeds} feed(s) failed — rows from those feeds were left as they were`); process.exitCode = 1; }
