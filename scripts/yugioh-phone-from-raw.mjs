/**
 * Grow backups/yugioh-phone/batch.json from eBay search rows scraped in the
 * browser pane (10-01; the 09-29 batch was built the same way by hand).
 * Raw file lines: itemId|imageId|title (a trailing " ~scan" marks a bare card
 * scan). Truth comes from the title: the set code ("RA04-EN054", "LOB-005")
 * names the card; the rarity the title spells out, among the rarities the
 * catalog has for that code, is the printing (null when the title names none
 * and the code has several). One row per code. Idempotent.
 * Run: node scripts/yugioh-phone-from-raw.mjs [--raw raw-1001.txt] [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const DIR = path.join(root, "backups/yugioh-phone");
const LIST = path.join(DIR, "batch.json");
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : null; };
const dry = process.argv.includes("--dry");
const raw = fs.readFileSync(path.join(DIR, arg("raw") ?? "raw-1001.txt"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.split("|"));
const batch = JSON.parse(fs.readFileSync(LIST, "utf8"));
// Same shape as lib/yugioh.ts yugiohKey: the code without its language letters.
const keyOf = (n) => { const m = /^([A-Z0-9]{2,6})\s*-\s*(?:EN|E|NA)?([A-Z]?\d{2,4}[A-Z]?|TKN)$/.exec(String(n).trim().toUpperCase()); return m ? `${m[1]}-${m[2]}` : null; };
const have = new Set(batch.map((p) => keyOf(p.number)));
const mirror = new DatabaseSync(path.join(root, "data/cardflip.db"), { readOnly: true });
const all = mirror.prepare("SELECT id, name, collector_number, rarity, variant FROM tcg_cards WHERE game = 'yugioh'").all();
const byKey = Map.groupBy(all, (r) => keyOf(r.collector_number));
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
// What sellers write for each catalog rarity (longest first, so "Secret Rare" does not eat "Platinum Secret Rare").
const SAYS = [
  ["Quarter Century Secret Rare", /quarter century|\bqcsr\b|\bqcr\b|25th secret/i], ["Platinum Secret Rare", /platinum secret|\bplsr\b/i],
  ["Prismatic Collector's Rare", /prismatic collector/i], ["Prismatic Ultimate Rare", /prismatic ultimate/i], ["Prismatic Secret Rare", /prismatic secret/i],
  ["Gold Secret Rare", /gold secret/i], ["Premium Gold Rare", /premium gold/i], ["Starlight Rare", /starlight/i], ["Collector's Rare", /collector'?s rare|\bcr\b/i],
  ["Ghost Rare", /ghost rare/i], ["Ultimate Rare", /ultimate rare|\bulti\b/i], ["Starfoil Rare", /starfoil/i], ["Shatterfoil Rare", /shatterfoil/i], ["Mosaic Rare", /mosaic/i],
  ["Gold Rare", /gold rare/i], ["Secret Rare", /secret rare|\bscr\b/i], ["Ultra Rare", /ultra rare|\bur\b/i], ["Super Rare", /super rare|\bsr\b/i], ["Rare", /\brare\b/i], ["Common", /\bcommon\b/i],
];

let added = 0;
const dropped = [];
for (const [itemId, imageId, ...rest] of raw) {
  const scan = / ~scan$/.test(rest.join("|"));
  const title = rest.join("|").replace(/ ~scan$/, "");
  const code = /\b([A-Z0-9]{2,6}-(?:EN|E|NA)?[A-Z]?\d{2,4})\b/.exec(title.toUpperCase());
  const key = code && keyOf(code[1]);
  const rows = (key && byKey.get(key)) ?? [];
  if (rows.length === 0) { dropped.push(`no catalog row for ${code?.[1] ?? "(no code)"}: ${title}`); continue; }
  if (have.has(key)) continue;
  // The code names one card; a title whose words share nothing with that card's name is a mislabeled listing.
  const name = rows[0].name;
  const t = norm(title);
  if (!name.split(/[^A-Za-z0-9]+/).filter((w) => w.length > 3).some((w) => t.includes(norm(w))) && !t.includes(norm(name))) { dropped.push(`name not in title (${name}): ${title}`); continue; }
  const rarities = [...new Set(rows.map((r) => r.rarity))];
  const stripped = title.replace(code[1], " ");
  const said = SAYS.find(([rarity, re]) => rarities.includes(rarity) && re.test(stripped))?.[0] ?? null;
  const wantRarity = said ?? (rarities.length === 1 ? rarities[0] : null);
  const id = `s1001-${itemId}`;
  const file = path.join(DIR, `${id}.jpg`);
  if (!dry && !fs.existsSync(file)) {
    try {
      const res = await fetch(`https://i.ebayimg.com/images/g/${imageId}/s-l1600.jpg`, { headers: { "User-Agent": "CardFlip-phone/1.0" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`image ${res.status}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    } catch (err) { dropped.push(`${key}: ${err?.message ?? err}`); continue; }
  }
  batch.push({ id, bucket: wantRarity ?? "null", name, number: rows[0].collector_number, wantRarity, first: /1st|first ed/i.test(title), title, listing: `https://www.ebay.com/itm/${itemId}`, pass: "1001", scan });
  have.add(key);
  added++;
}
if (!dry) fs.writeFileSync(LIST, JSON.stringify(batch, null, 1));
console.log(`added ${added}; batch now ${batch.length}${dry ? " (dry)" : ""}`);
for (const d of dropped) console.log("  dropped:", d);
