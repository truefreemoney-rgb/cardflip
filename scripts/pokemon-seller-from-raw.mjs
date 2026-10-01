/**
 * Build backups/pokemon-phone/seller.json from eBay search rows scraped in the
 * browser pane (10-01; the One Piece / Yu-Gi-Oh! way, no eBay API keys locally).
 * Raw file lines: itemId|imageId|title. Truth comes from the title: the printed
 * "number/total" plus the card name must land on exactly ONE row of the local
 * mirror's en_cards (a title that says 1st Edition wants the "-1st" twin when the
 * catalog has one); anything else is dropped and printed. Downloads the seller's
 * first photo (s-l1600). Idempotent.
 * Run: node scripts/pokemon-seller-from-raw.mjs [--raw seller-raw1.txt] [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const DIR = path.join(root, "backups/pokemon-phone");
const LIST = path.join(DIR, "seller.json");
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : null; };
const dry = process.argv.includes("--dry");
const raw = fs.readFileSync(path.join(DIR, arg("raw") ?? "seller-raw1.txt"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.split("|"));
const batch = fs.existsSync(LIST) ? JSON.parse(fs.readFileSync(LIST, "utf8")) : [];
const haveWant = new Set(batch.map((p) => p.want));
const mirror = new DatabaseSync(path.join(root, "data/cardflip.db"), { readOnly: true });
const all = mirror.prepare("SELECT id, name, set_name, local_id, set_card_count_official AS official FROM en_cards").all();
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const numKey = (s) => String(s).toUpperCase().replace(/^([A-Z]*)0+(?=\d)/, "$1");
const byNumber = Map.groupBy(all, (c) => numKey(c.local_id));

let added = 0;
const dropped = [];
for (const [itemId, imageId, ...rest] of raw) {
  const title = rest.join("|");
  const m = /([A-Za-z]{0,3}\d{1,3})\s?\/\s?([A-Za-z]{0,3}\d{2,3})\b/.exec(title);
  if (!m) { dropped.push(`no number: ${title}`); continue; }
  const total = Number(m[2].replace(/\D/g, ""));
  const lettered = /[A-Za-z]/.test(m[2]);
  const t = norm(title);
  const first = /1st\s*ed/i.test(title);
  let rows = (byNumber.get(numKey(m[1])) ?? []).filter((c) => lettered || Number(c.official) === total);
  rows = rows.filter((c) => c.name.toLowerCase().split(/[^a-z0-9é]+/).filter((w) => w.length > 1).every((w) => t.includes(norm(w))));
  const twins = rows.filter((c) => c.id.endsWith("-1st"));
  rows = first && twins.length ? twins : rows.filter((c) => !c.id.endsWith("-1st"));
  // The Trainer Gallery subsets sit in the catalog twice (swsh11tg and swsh11.5tg): same card, either id is right.
  const sameCard = rows.length > 1 && rows.every((c) => c.name === rows[0].name && c.set_name === rows[0].set_name && c.local_id === rows[0].local_id);
  if (rows.length !== 1 && !sameCard) { dropped.push(`${rows.length} rows (${rows.map((c) => c.id).join(", ")}): ${title}`); continue; }
  const want = rows[0];
  if (haveWant.has(want.id)) continue;
  const id = `seller-${itemId}`;
  const file = path.join(DIR, `${id}.jpg`);
  if (!dry && !fs.existsSync(file)) {
    try {
      const res = await fetch(`https://i.ebayimg.com/images/g/${imageId}/s-l1600.jpg`, { headers: { "User-Agent": "CardFlip-phone/1.0" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`image ${res.status}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    } catch (err) { dropped.push(`${want.id}: ${err?.message ?? err}`); continue; }
  }
  batch.push({ id, name: want.name, set: want.set_name, number: want.local_id, want: want.id, ...(rows.length > 1 ? { alt: rows.slice(1).map((c) => c.id) } : {}), title, listing: `https://www.ebay.com/itm/${itemId}` });
  haveWant.add(want.id);
  added++;
}
if (!dry) fs.writeFileSync(LIST, JSON.stringify(batch, null, 1));
console.log(`added ${added}; seller batch now ${batch.length}${dry ? " (dry)" : ""}`);
for (const d of dropped) console.log("  dropped:", d);
