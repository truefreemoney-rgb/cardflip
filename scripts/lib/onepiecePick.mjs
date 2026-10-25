// Which TCGplayer product's picture a One Piece row shows (sync-onepiece-images.mjs, 10-25).
// The old rule paired a row with the same-number product of its printing class across EVERY tcgcsv group, in
// product-id order, so a reprint, a promo or another set's Super Alt Art took the slot: 361 rows showed another
// printing's picture (10-24), the OP13-118 Red Super Alt Art swapped onto the $7,500 and $4,800 Luffys among them.
// Now, in order:
//   1. the same-number product within 15% of the row's own price (the feed prices each printing from TCGplayer):
//      own set first, then the printing word, then the closest; another set's product must say the word or share the class
//   2. the row's own set, same class or the printing word, paired in order (_p1 -> first parallel ...),
//      dropped when its market is 2x+ off the row's price (another printing)
//   3. the old pick, when it is the row's own set, or not a promo group and within 2x of the row's price
//   4. nothing: the row shows Bandai's picture of itself
// Pure: rows from tcg_cards, products from tcgcsv; scripts/test-onepiece-images.mjs holds the measured cases.

// "Monkey.D.Luffy (003) (Parallel)" → printing tags without the card-number tag.
export function tagsOf(name) {
  const tags = [];
  for (const m of String(name).matchAll(/\(([^)]+)\)/g)) {
    const t = m[1].trim().toLowerCase();
    if (!/^\d+$/.test(t)) tags.push(t);
  }
  return tags;
}
// Our variant column ↔ a tcgcsv tag class.
export function classOf(tags) {
  const s = tags.join(" ");
  if (!s) return "base";
  if (/manga/.test(s)) return "manga";
  if (/box topper/.test(s)) return "box-topper";
  if (/alternate|alt art/.test(s)) return "alt-art";
  if (/parallel/.test(s)) return "parallel";
  if (/reprint/.test(s)) return "base";
  return "other";
}
export function ourClass(variant) {
  if (!variant || variant === "reprint") return "base";
  if (/^(parallel|alt-art|manga|box-topper)$/.test(variant)) return variant;
  return "other";
}

// A product's TCGplayer group is the row's own set. TCGplayer names starter decks "ST-05: Starter Deck 5 Film
// Edition" where the feed says "Starter Deck 5: Film Edition"; "Vol. 2" has to be on both sides or neither.
export const foldSet = (s) => String(s ?? "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const SET_STOP = new Set(["starter", "deck", "ultra", "ex", "the", "of", "and", "st", "vol"]);
export const setWords = (s) => foldSet(s).replace(/^st \d+ /, "").split(" ").filter((w) => w && !SET_STOP.has(w) && !/^\d+$/.test(w));
export const sameSet = (rowSet, group) => {
  const a = setWords(rowSet), b = new Set(setWords(group));
  return a.length > 0 && a.every((w) => b.has(w)) && /\bvol 2\b/.test(foldSet(rowSet)) === /\bvol 2\b/.test(foldSet(group));
};
// The words a feed printing goes by in TCGplayer's product names ("gold" -> "Buggy - OP09-051 (SP) (Gold)").
export const WORDS = {
  special: ["sp", "special"], "alt-art": ["alternate art", "parallel"], parallel: ["parallel", "alternate art"], manga: ["manga"], gold: ["gold"], silver: ["silver"],
  "full-art": ["full art"], spr: ["spr", "super parallel"], tr: ["treasure", "tr"], "pirate-foil": ["pirate foil"], "jolly-roger-foil": ["jolly roger"],
  "textured-foil": ["textured"], "gold-stamped-signature": ["signature"], "box-topper": ["box topper"], reprint: ["reprint"],
};
export const ratio = (a, b) => (a > 0 && b > 0 ? Math.max(a, b) / Math.min(a, b) : null);
export const promoGroup = (g) => /promotion|pre-release|tournament|release event|anniversary|championship|judge|winner|participant/i.test(g);

/**
 * rows: { id, set_name, collector_number, variant, price_usd } in id order (pairing order).
 * byNumber: Number ("OP13-118") → products { id, name, cls, group, market } in product-id order.
 * Returns picks ({ row, pick, exact }: exact = the row's own printing, not a fallback), the unmatched row ids, and a tally.
 */
export function pickPictures(rows, byNumber) {
  const taken = new Map(); // number|cls|set → how many used
  const takenOld = new Map(); // number|cls → how many used (the old rule's pairing)
  const how = { price: 0, own: 0, keptOld: 0, offPrice: 0, none: 0 };
  const picks = [];
  const unmatched = [];
  for (const r of rows) {
    const number = r.collector_number.toUpperCase();
    const cls = ourClass(r.variant);
    const all = byNumber.get(number) ?? [];
    const words = WORDS[r.variant] ?? [];
    const said = (p) => words.some((w) => tagsOf(p.name).join(" ").includes(w));
    const own = all.filter((p) => sameSet(r.set_name, p.group));
    // The pick the old rule made (number + class across every set, in product-id order): it stands unless something
    // says it is another printing (another set's promo / pre-release / tournament product, or a market 2x+ off).
    const oldPool = all.filter((p) => p.cls === cls);
    const ko = `${number}|${cls}`;
    const io = takenOld.get(ko) ?? 0;
    let old = oldPool[io] ?? oldPool[oldPool.length - 1] ?? null;
    if (!old && cls === "base" && all.length === 1) old = all[0];
    if (old) takenOld.set(ko, io + 1);
    const oldOk = !!old && (own.includes(old) || (!promoGroup(old.group) && (ratio(old.market, r.price_usd) ?? 1) <= 2));
    // 1) By price. Another set's product counts only when the row's own set lists none of its printing (10-25: sub-$1
    //    prints sit within 15% of each other, so OP09-004 took Premium Booster Vol. 2's reprint over its own base,
    //    and the $1,003 OP05-069 manga took the Premium Booster manga).
    const ownHas = own.some((p) => p.cls === cls || said(p));
    const byPrice = r.price_usd > 0
      ? all.filter((p) => (ratio(p.market, r.price_usd) ?? 9) <= 1.15 && (own.includes(p) || (!ownHas && (said(p) || p.cls === cls))))
      : [];
    byPrice.sort((a, b) => Number(own.includes(b)) - Number(own.includes(a)) || Number(said(b)) - Number(said(a)) || ratio(a.market, r.price_usd) - ratio(b.market, r.price_usd));
    let pick = byPrice[0] ?? null;
    let exact = !!pick;
    if (pick) how.price++;
    if (!pick) {
      // 2) Own set, paired in order.
      const pool = own.filter((p) => p.cls === cls || said(p));
      const k = `${number}|${cls}|${foldSet(r.set_name)}`;
      const i = taken.get(k) ?? 0;
      pick = pool[i] ?? pool[pool.length - 1] ?? null;
      if (!pick && cls === "base" && own.length === 1) pick = own[0];
      else if (!pick && (cls === "parallel" || cls === "alt-art")) pick = own.filter((p) => p.cls === "parallel" || p.cls === "alt-art")[i] ?? null;
      if (pick) taken.set(k, i + 1);
      exact = !!pick && pick === pool[i];
      const off = pick ? ratio(pick.market, r.price_usd) : null;
      if (pick && off != null && off > 2) {
        how.offPrice++;
        pick = null;
      } else if (pick) how.own++;
    }
    // 3) The old pick when nothing speaks against it; 4) else Bandai's picture of the row itself.
    if (!pick && oldOk) {
      pick = old;
      exact = old === oldPool[io];
      how.keptOld++;
    }
    if (!pick) {
      how.none++;
      unmatched.push(r.id);
      continue;
    }
    picks.push({ row: r, pick, exact });
  }
  return { picks, unmatched, how };
}
