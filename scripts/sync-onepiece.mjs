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

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

const upsert = db.prepare(`INSERT INTO tcg_cards (id, game, name, subtitle, set_code, set_name, collector_number, set_total, set_release_date, rarity, variant, image_url, price_usd, price_usd_foil, synced_at)
  VALUES (?, 'onepiece', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, subtitle = excluded.subtitle, set_code = excluded.set_code, set_name = excluded.set_name,
    collector_number = excluded.collector_number, set_total = excluded.set_total, rarity = excluded.rarity, variant = excluded.variant,
    image_url = excluded.image_url, price_usd = excluded.price_usd, price_usd_foil = excluded.price_usd_foil, synced_at = excluded.synced_at`);

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
  rest = rest.replace(/s+-s+[A-Z]+d*-d+[a-z0-9_#]*$/i, "").trim();
  return { name: rest, variant };
}

const now = Date.now();
let total = 0;
const seenIds = new Set();
for (const [label, url] of [["sets", `${API}/allSetCards/`], ["starter decks", `${API}/allSTCards/`], ["promos", `${API}/allPromoCards/`]]) {
  let rows;
  try {
    rows = await getJson(url);
  } catch (err) {
    console.log(`  !! ${label}: ${err.message}`);
    continue;
  }
  rows = Array.isArray(rows) ? rows : rows.results ?? rows.data ?? [];
  db.exec("BEGIN");
  for (const c of rows) {
    const key = String(c.card_set_id ?? "").trim(); // OP01-077
    if (!key) continue;
    const imageId = String(c.card_image_id ?? key);
    const { name, variant: nameVariant } = splitVariant(c.card_name);
    // Two rows can share card_set_id (base + parallel); the image id is unique.
    let id = `${imageId}`;
    if (seenIds.has(id)) id = `${imageId}#${seenIds.size}`;
    seenIds.add(id);
    // Image-id suffixes: "_p1" / "_p2" are parallels (alternate art), "_r1" a reprint.
    const suffix = imageId !== key ? imageId.slice(key.length).replace(/^[_-]+/, "").toLowerCase() : "";
    const variant = nameVariant || (/^p\d/.test(suffix) ? "parallel" : /^r\d/.test(suffix) ? "reprint" : suffix);
    const setCode = String(c.set_id ?? key.split("-")[0]).replace("-", ""); // "OP-01" → "OP01"
    upsert.run(
      id,
      name,
      "",
      setCode,
      String(c.set_name ?? ""),
      key.replace(/_[rp]d+$/i, ""), // the feed keys a few reprints "P-029_r1"; the face says P-029
      null,
      "",
      String(c.rarity ?? ""),
      variant,
      String(c.card_image ?? ""),
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
