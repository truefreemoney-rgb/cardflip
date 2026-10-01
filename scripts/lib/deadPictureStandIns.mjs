// A Yu-Gi-Oh printing whose TCGplayer picture is dead (the CDN answers 403:
// no scan of that product) shows another printing of the same card instead.
// Shared by sync-yugioh.mjs (every sync re-creates the dead links) and
// repoint-dead-pictures.mjs (local + prod, 10-01).
//
// The stand-in is the same name with a live picture: the same variant tag
// first; then any tag that is a treatment of the same art (starfoil, green,
// ots-stamp …). "alt-art" is different art and only ever pairs with alt-art.
// Closest release date wins: a reprint near in time is the likeliest to
// share the artwork.
//
// Last resort (10-01): a card no printing shows at all (a brand-new set) gets
// the picture we host ourselves, `own` = scripts/yugioh-own-pictures.json
// (card name -> URL, built by fill-yugioh-own-pictures.mjs). It is the card's
// standard artwork, so alt-art and extended-art rows never take it.
import fs from "node:fs";
import path from "node:path";

/** The pictures we host ourselves, by card name ({} when the file is not there). */
export function ownPictures(game = "yugioh") {
  const file = path.join(process.cwd(), "scripts", `${game}-own-pictures.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

const OTHER_ART = new Set(["alt-art", "extended-art"]);

/**
 * @param {{ id: string, name: string, variant: string, image_url: string, set_release_date: string }[]} rows one game's rows
 * @param {Set<string>} dead picture links that do not answer
 * @param {Record<string, string>} [own] card name -> a picture we host
 * @returns {Map<string, string>} row id -> stand-in picture, for the dead rows that have one
 */
export function deadPictureStandIns(rows, dead, own = {}) {
  const live = new Map();
  for (const r of rows) {
    if (!r.image_url || dead.has(r.image_url)) continue;
    if (!live.has(r.name)) live.set(r.name, []);
    live.get(r.name).push(r);
  }
  const day = (r) => Date.parse(r.set_release_date || "") || 0;
  const out = new Map();
  for (const r of rows) {
    if (!dead.has(r.image_url)) continue;
    const same = live.get(r.name) ?? [];
    let pool = same.filter((s) => s.variant === r.variant);
    if (!pool.length && r.variant !== "alt-art") pool = same.filter((s) => s.variant !== "alt-art");
    if (!pool.length) {
      if (own[r.name] && !OTHER_ART.has(r.variant)) out.set(r.id, own[r.name]);
      continue;
    }
    pool.sort((a, b) => Math.abs(day(a) - day(r)) - Math.abs(day(b) - day(r)) || String(a.id).localeCompare(String(b.id)));
    out.set(r.id, pool[0].image_url);
  }
  return out;
}
