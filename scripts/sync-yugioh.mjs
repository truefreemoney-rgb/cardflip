// Yu-Gi-Oh! mirror from TCGplayer's catalogue via tcgcsv.com (category 2,
// ~660 groups; two static files per group, four at a time). Writes tcg_cards
// rows with game = 'yugioh' (docs/NEW-GAMES.md).
//
//   npm run sync:yugioh
//
// Printed key: the set code "LOB-EN005" under the art, right side. TCGplayer
// keeps one product per printing (set code + rarity), with its own picture
// on the TCGplayer CDN (YGOPRODeck asks not to hotlink, so it is not used).
// 1st Edition is stamped on the card and sells for far more than Unlimited
// (LOB Dark Magician 09-29: $1,208 vs $43), so a printing priced both ways
// gets a "-1st" twin row, same as Pokémon's 1st Edition twins.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { deadPictureStandIns, ownPictures } from "./lib/deadPictureStandIns.mjs";

const API = "https://tcgcsv.com/tcgplayer/2";
const HEADERS = { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)", Accept: "application/json" };
const db = new DatabaseSync(process.env.CARDFLIP_DB_PATH ?? path.join(process.cwd(), "data", "cardflip.db"));
db.exec(`CREATE TABLE IF NOT EXISTS tcg_cards (
  id TEXT PRIMARY KEY, game TEXT NOT NULL, name TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '',
  set_code TEXT NOT NULL, set_name TEXT NOT NULL, collector_number TEXT NOT NULL, set_total INTEGER,
  set_release_date TEXT NOT NULL DEFAULT '', rarity TEXT NOT NULL DEFAULT '', variant TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '', price_usd REAL, price_usd_foil REAL, art_hash TEXT NOT NULL DEFAULT '',
  synced_at INTEGER NOT NULL)`);

async function getJson(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`${url} → ${res.status}`);
      return (await res.json()).results ?? [];
    } catch (err) {
      if (attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

const upsert = db.prepare(`INSERT INTO tcg_cards (id, game, name, subtitle, set_code, set_name, collector_number, set_total, set_release_date, rarity, variant, image_url, price_usd, price_usd_foil, synced_at)
  VALUES (?, 'yugioh', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, subtitle = excluded.subtitle, set_code = excluded.set_code, set_name = excluded.set_name,
    collector_number = excluded.collector_number, set_total = excluded.set_total, set_release_date = excluded.set_release_date,
    rarity = excluded.rarity, variant = excluded.variant, image_url = excluded.image_url, price_usd = excluded.price_usd,
    price_usd_foil = excluded.price_usd_foil, synced_at = excluded.synced_at`);

// "Dark Magician (Alternate Art)" → name + variant "alt-art"; "(25th Anniversary)"
// → "25th"; other tags folded to a slug. The printed name has no tag.
function splitVariant(raw) {
  let rest = (raw ?? "").trim();
  let variant = "";
  for (;;) {
    const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(rest);
    if (!m) break;
    rest = m[1].trim();
    const tag = m[2].toLowerCase().trim();
    const v = /alternate|alt art/.test(tag) ? "alt-art" : /25th/.test(tag) ? "25th" : tag.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!variant) variant = v;
  }
  return { name: rest, variant };
}

const ext = (p, key) => p.extendedData?.find((e) => e.name === key)?.value ?? "";
const bigImage = (url) => String(url ?? "").replace(/_200w\.jpg$/, "_in_1000x1000.jpg");

const groups = await getJson(`${API}/groups`);
const now = Date.now();
const rows = [];
let done = 0;
let failed = 0;
async function worker(queue) {
  for (let g = queue.shift(); g; g = queue.shift()) {
    try {
      const [products, prices] = await Promise.all([getJson(`${API}/${g.groupId}/products`), getJson(`${API}/${g.groupId}/prices`)]);
      const byProduct = new Map();
      for (const p of prices) {
        if (!byProduct.has(p.productId)) byProduct.set(p.productId, {});
        byProduct.get(p.productId)[p.subTypeName] = p.marketPrice ?? p.midPrice ?? null;
      }
      for (const p of products) {
        const number = ext(p, "Number").trim().toUpperCase();
        if (!number) continue; // sealed product, no card
        const { name, variant } = splitVariant(p.name);
        const priced = byProduct.get(p.productId) ?? {};
        const base = {
          name,
          subtitle: "", // toCard joins it onto the name; Yu-Gi-Oh! prints no version line
          setCode: g.abbreviation || number.split("-")[0],
          setName: g.name,
          number,
          released: String(g.publishedOn ?? "").slice(0, 10),
          rarity: ext(p, "Rarity"),
          variant,
          image: bigImage(p.imageUrl),
        };
        const first = priced["1st Edition"] ?? null;
        const unl = priced["Unlimited"] ?? priced["Limited"] ?? null;
        const other = Object.entries(priced).find(([k]) => !/^(1st Edition|Unlimited|Limited)$/.test(k))?.[1] ?? null;
        // "-1st" on the id marks the stamped print (listing.ts isFirstEditionCard
        // reads it); variant keeps the name tag. Both priced → twins; a 1st-only
        // printing is one "-1st" row.
        if (unl != null || (first == null && other != null)) rows.push({ ...base, id: `ygo-${p.productId}`, price: unl ?? other });
        if (first != null) rows.push({ ...base, id: `ygo-${p.productId}-1st`, price: first });
        if (first == null && unl == null && other == null) rows.push({ ...base, id: `ygo-${p.productId}`, price: null });
      }
    } catch (err) {
      failed++;
      console.log(`  !! ${g.name}: ${err.message}`);
    }
    if (++done % 100 === 0) console.log(`  ${done}/${groups.length} groups`);
  }
}
const queue = [...groups];
await Promise.all([1, 2, 3, 4].map(() => worker(queue)));

db.exec("BEGIN");
db.exec("DELETE FROM tcg_cards WHERE game = 'yugioh'");
for (const r of rows) {
  upsert.run(r.id, r.name, r.subtitle, r.setCode, r.setName, r.number, null, r.released, r.rarity, r.variant, r.image, r.price, null, now);
}
db.exec("COMMIT");
// TCGplayer has no scan for ~1,700 of these products (its CDN answers 403):
// they show another printing of the same card (10-01). The dead list is
// refreshed by scripts/sweep-picture-links.mjs.
const deadFile = path.join(process.cwd(), "scripts", "dead-pictures-yugioh.json");
if (fs.existsSync(deadFile)) {
  const standIns = deadPictureStandIns(db.prepare("SELECT id, name, variant, image_url, set_release_date FROM tcg_cards WHERE game = 'yugioh'").all(), new Set(JSON.parse(fs.readFileSync(deadFile, "utf8"))), ownPictures("yugioh"));
  const repoint = db.prepare("UPDATE tcg_cards SET image_url = ? WHERE id = ?");
  db.exec("BEGIN");
  for (const [id, url] of standIns) repoint.run(url, id);
  db.exec("COMMIT");
  console.log(`  ${standIns.size} dead pictures show another printing`);
}
const n = db.prepare("SELECT COUNT(*) AS n FROM tcg_cards WHERE game = 'yugioh'").get().n;
const unpriced = db.prepare("SELECT COUNT(*) AS n FROM tcg_cards WHERE game = 'yugioh' AND price_usd IS NULL").get().n;
const variants = db.prepare("SELECT variant, COUNT(*) AS n FROM tcg_cards WHERE game = 'yugioh' GROUP BY variant ORDER BY n DESC LIMIT 8").all();
console.log(`yugioh: ${groups.length} groups (${failed} failed), ${n} rows, ${unpriced} unpriced; variants: ${variants.map((v) => `${v.variant || "base"}=${v.n}`).join(", ")}`);
