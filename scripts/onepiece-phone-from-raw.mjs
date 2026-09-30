/**
 * Grow backups/onepiece-phone/batch.json from eBay search pages scraped in
 * the browser pane (09-30; no eBay API keys locally — the Yu-Gi-Oh! way).
 * raw2.json rows: [number, imageId, itemId, bucket, title]. Looks each
 * number up in the local mirror for the card name, downloads the seller's
 * photo (s-l1600), appends a batch row per NEW number. Idempotent.
 * Run: node scripts/onepiece-phone-from-raw.mjs [--limit N]
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const DIR = path.join(root, "backups/onepiece-phone");
const LIST = path.join(DIR, "batch.json");
const raw = JSON.parse(fs.readFileSync(path.join(DIR, "raw2.json"), "utf8"));
const batch = JSON.parse(fs.readFileSync(LIST, "utf8"));
const have = new Set(batch.map((p) => p.number));
const mirror = new DatabaseSync(path.join(root, "data/cardflip.db"), { readOnly: true });
const cleanName = (n) => String(n).replace(/\s+-\s+[A-Z]+\d*-\d+[a-z0-9_#]*$/i, "").trim();
const WANT = { base: "", alt: "parallel", manga: "manga", reprint: "reprint" };
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

let added = 0;
for (const [number, imageId, itemId, bucket, title] of raw) {
  if (added >= limit) break;
  const num = number.toUpperCase();
  if (have.has(num)) continue;
  const rows = mirror.prepare("SELECT id, name, variant FROM tcg_cards WHERE game='onepiece' AND (collector_number = ? OR collector_number LIKE ?) ORDER BY CASE WHEN variant='' THEN 0 ELSE 1 END, id").all(num, `${num}\\_%`);
  if (rows.length === 0) { console.log(`  no catalog row for ${num} (${title})`); continue; }
  const base = rows[0];
  const id = `${bucket}-${num}`;
  const file = path.join(DIR, `${id}.jpg`);
  if (!fs.existsSync(file)) {
    try {
      const res = await fetch(`https://i.ebayimg.com/images/g/${imageId}/s-l1600.jpg`, { headers: { "User-Agent": "CardFlip-phone/1.0" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`image ${res.status}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    } catch (err) { console.log(`  ${num}: ${err?.message ?? err}`); continue; }
  }
  batch.push({ id, bucket, name: cleanName(base.name), number: num, want: base.id, wantVariant: WANT[bucket] ?? "", title, listing: `https://www.ebay.com/itm/${itemId}` });
  have.add(num);
  added++;
}
fs.writeFileSync(LIST, JSON.stringify(batch, null, 1));
console.log(`added ${added}; batch now ${batch.length}`);
