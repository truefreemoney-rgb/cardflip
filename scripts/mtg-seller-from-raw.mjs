/**
 * Build backups/mtg-phone/seller.json from eBay search rows scraped in the
 * browser pane (10-01; the Pokémon / One Piece way, no eBay API keys locally).
 * Raw file lines: itemId|imageId|title. Truth comes from the title: the longest
 * set name (or a bracketed set code) found in it, then the longest card name of
 * THAT set found in it. A title cannot say which printing of the name in the set
 * (showcase, borderless, foil), so `want` is every row of that name in that set,
 * narrowed by a "#123" / "123/281" collector number when the title prints one.
 * Anything without exactly one set + one name is dropped and printed.
 * Run: node scripts/mtg-seller-from-raw.mjs [--raw seller-raw1.txt] [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const DIR = path.join(root, "backups/mtg-phone");
const LIST = path.join(DIR, "seller.json");
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : null; };
const dry = process.argv.includes("--dry");
const raw = fs.readFileSync(path.join(DIR, arg("raw") ?? "seller-raw1.txt"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.split("|"));
const batch = fs.existsSync(LIST) ? JSON.parse(fs.readFileSync(LIST, "utf8")) : [];
const have = new Set(batch.map((p) => p.key));
const mirror = new DatabaseSync(path.join(root, "data/cardflip.db"), { readOnly: true });
const norm = (s) => ` ${String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
const sets = mirror.prepare("SELECT set_code, set_name, COUNT(*) n FROM mtg_cards WHERE lang = 'en' GROUP BY set_code, set_name").all()
  .map((s) => ({ ...s, key: norm(s.set_name) }))
  .sort((a, b) => b.key.length - a.key.length);
const inSet = mirror.prepare("SELECT id, name, collector_number, frame, frame_effects, promo_types, border_color, finishes, full_art, textless FROM mtg_cards WHERE set_code = ? AND lang = 'en'");

let added = 0;
const dropped = [];
for (const [itemId, imageId, ...rest] of raw) {
  const title = rest.join("|");
  const t = norm(title);
  // Set: a set code the title spells out ("- MH2 -", "[CLB - 198]", "(NEO)"), else the longest set
  // name in the title (8+ chars, so "Legends" does not fire on a card name).
  const coded = /(?:^|\s)-\s([A-Z0-9]{3,4})\s-\s|\[([A-Z0-9]{3,4})\s-\s\d+\]|\(([A-Z0-9]{3,4})\)/.exec(title);
  const code = (coded?.[1] ?? coded?.[2] ?? coded?.[3] ?? "").toLowerCase();
  const set = (code && sets.find((s) => s.set_code === code)) || sets.find((s) => s.key.trim().length >= 8 && t.includes(s.key));
  if (!set) { dropped.push(`no set: ${title}`); continue; }
  const rows = inSet.all(set.set_code);
  const rest2 = t.replace(set.key, " ");
  const names = [...new Set(rows.map((r) => r.name))]
    .map((n) => ({ n, key: norm(n.split(" // ")[0]) }))
    .filter((x) => rest2.includes(x.key))
    .sort((a, b) => b.key.length - a.key.length);
  if (names.length === 0) { dropped.push(`no ${set.set_code} card: ${title}`); continue; }
  // A shorter name inside the longest one ("Bolt" in "Lightning Bolt") is not a second card.
  const name = names[0];
  if (names.slice(1).some((x) => !name.key.includes(x.key))) { dropped.push(`two cards (${names.map((x) => x.n).join(" / ")}): ${title}`); continue; }
  const loose = rows.filter((r) => r.name === name.n);
  let want = loose;
  // Which printing: a collector number the title prints ("#259", "(239)", "(163/306)", "[CLB - 198]", "0284", "- 116 -") …
  const nums = [...title.matchAll(/#\s?(\d{1,4}[a-z]?)\b|\((\d{1,4})(?:\/\d+)?\)|\s-\s(\d{1,4})\]|\b(0\d{3})\b|\s-\s(\d{1,4})\s+-\s|\s(\d{1,4})\s/gi)]
    .map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6]).replace(/^0+/, "").toLowerCase());
  const byNumber = loose.filter((r) => nums.includes(r.collector_number.replace(/^0+/, "").toLowerCase()));
  // … else the treatment it names; a title naming none is the regular card.
  const fx = (r) => `${r.frame_effects} ${r.promo_types}`;
  const special = (r) => r.border_color === "borderless" || /showcase|extendedart|etched|inverted/.test(fx(r)) || r.full_art || r.textless || r.frame === "1997" && rows.some((x) => x.frame !== "1997");
  const said = /borderless/i.test(title) ? (r) => r.border_color === "borderless"
    : /showcase/i.test(title) ? (r) => /showcase/.test(fx(r))
    : /extended art/i.test(title) ? (r) => /extendedart/.test(fx(r))
    : /retro frame/i.test(title) ? (r) => r.frame === "1997"
    : /etched/i.test(title) ? (r) => /etched/.test(`${fx(r)} ${r.finishes}`)
    : (r) => !special(r);
  if (byNumber.length) want = byNumber;
  else if (loose.some(said)) want = loose.filter(said);
  const key = `${set.set_code}:${name.n}`;
  if (have.has(key)) continue;
  const id = `seller-${itemId}`;
  const file = path.join(DIR, `${id}.jpg`);
  if (!dry && !fs.existsSync(file)) {
    try {
      const res = await fetch(`https://i.ebayimg.com/images/g/${imageId}/s-l1600.jpg`, { headers: { "User-Agent": "CardFlip-phone/1.0" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`image ${res.status}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    } catch (err) { dropped.push(`${key}: ${err?.message ?? err}`); continue; }
  }
  batch.push({ id, key, name: name.n, set: set.set_name, setCode: set.set_code, want: want.map((r) => r.id), loose: loose.map((r) => r.id), title, listing: `https://www.ebay.com/itm/${itemId}` });
  have.add(key);
  added++;
}
if (!dry) fs.writeFileSync(LIST, JSON.stringify(batch, null, 1));
console.log(`added ${added}; seller batch now ${batch.length}${dry ? " (dry)" : ""}`);
for (const d of dropped) console.log("  dropped:", d);
