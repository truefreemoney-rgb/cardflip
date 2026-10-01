/**
 * Grow backups/lorcana-phone/batch.json from eBay search rows scraped in the
 * browser pane (10-01; the Pokémon / Magic way, no eBay API keys locally).
 * Raw file lines: itemId|imageId|title (a trailing " ~scan" marks a bare card
 * scan). Truth comes from the title: "number/total" plus a card name that both
 * sit on ONE card of the local mirror (name + version + number + total; a
 * reprint of the same card in two sets is still one card for the harness).
 * Anything else is dropped and printed. Idempotent.
 * Run: node scripts/lorcana-phone-from-raw.mjs [--raw raw-1001.txt] [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const DIR = path.join(root, "backups/lorcana-phone");
const LIST = path.join(DIR, "batch.json");
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : null; };
const dry = process.argv.includes("--dry");
const raw = fs.readFileSync(path.join(DIR, arg("raw") ?? "raw-1001.txt"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.split("|"));
const batch = JSON.parse(fs.readFileSync(LIST, "utf8"));
const key = (p) => `${String(p.name).toLowerCase()}|${String(p.subtitle ?? "").toLowerCase()}|${p.number}|${p.total}`;
const have = new Set(batch.map(key));
const mirror = new DatabaseSync(path.join(root, "data/cardflip.db"), { readOnly: true });
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const byNumber = mirror.prepare("SELECT id, name, subtitle, set_code, set_name, collector_number, set_total, variant FROM tcg_cards WHERE game = 'lorcana' AND collector_number = ? AND set_total = ?");

let added = 0;
const dropped = [];
for (const [itemId, imageId, ...rest] of raw) {
  const scan = / ~scan$/.test(rest.join("|"));
  const title = rest.join("|").replace(/ ~scan$/, "");
  const m = /\b0*(\d{1,3})\s?\/\s?(\d{3})\b/.exec(title);
  if (!m) { dropped.push(`no number: ${title}`); continue; }
  const t = norm(title);
  let rows = byNumber.all(m[1], Number(m[2])).filter((r) => t.includes(norm(r.name)));
  // Several characters share a name on one number across sets ("Ursula" 59/204): the version in the title picks.
  const bySubtitle = rows.filter((r) => r.subtitle && t.includes(norm(r.subtitle)));
  if (bySubtitle.length) rows = bySubtitle;
  // Same name + version on that number (a reprint across sets) is one card; two different cards is no truth.
  const cards = new Set(rows.map((r) => `${r.name}|${r.subtitle}`));
  if (cards.size !== 1) { dropped.push(`${cards.size} cards (${[...cards].join(" / ")}): ${title}`); continue; }
  const want = rows.find((r) => t.includes(norm(r.set_name))) ?? rows[0];
  const row = { id: `s1001-${itemId}`, bucket: Number(m[1]) > Number(m[2]) ? "enchanted" : "base", name: want.name, subtitle: want.subtitle ?? "", number: want.collector_number, total: want.set_total, want: want.id, wantVariant: want.variant ?? "", title, listing: `https://www.ebay.com/itm/${itemId}`, pass: "1001", scan };
  if (have.has(key(row))) continue;
  const file = path.join(DIR, `${row.id}.jpg`);
  if (!dry && !fs.existsSync(file)) {
    try {
      const res = await fetch(`https://i.ebayimg.com/images/g/${imageId}/s-l1600.jpg`, { headers: { "User-Agent": "CardFlip-phone/1.0" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`image ${res.status}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    } catch (err) { dropped.push(`${want.id}: ${err?.message ?? err}`); continue; }
  }
  batch.push(row);
  have.add(key(row));
  added++;
}
if (!dry) fs.writeFileSync(LIST, JSON.stringify(batch, null, 1));
console.log(`added ${added}; batch now ${batch.length}${dry ? " (dry)" : ""}`);
for (const d of dropped) console.log("  dropped:", d);
