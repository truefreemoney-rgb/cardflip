// One-off (10-24, Chris): his TCGplayer app collection export -> Magic cards in HIS account (truefreemoney), one row
// per copy like a scan, category = our catalog's set name; his current uncategorized Magic rows get theirs too.
// Magic rows only (the file also holds 20 Pokémon rows: left alone). Dry run unless --write. Re-runnable: each copy
// carries client_id "tcgp-1024:<TCGplayer Id>:<n>", and createCard returns the first row for a repeated id.
// node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_import-tcgplayer-mtg.mjs "<csv>" [--write]
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl;
process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const [csvPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const WRITE = process.argv.includes("--write");
const EMAIL = "truefreemoney@gmail.com";
const MAP_FILE = "data/tcgplayer-scryfall-map-2026-10-24.json";

// ---- the file ----
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}
const all = parseCsv(fs.readFileSync(csvPath, "utf8").replace(/^﻿/, ""));
const magic = all.filter((r) => r["Product Line"] === "Magic: The Gathering");
const copiesOf = (r) => Number(r["Add to Quantity"] || 0) + Number(r["Total Quantity"] || 0) || 1;
console.log(`file: ${all.length} rows, Magic ${magic.length} (${magic.reduce((s, r) => s + copiesOf(r), 0)} copies), other games left alone: ${all.length - magic.length}`);

// ---- TCGplayer product -> Scryfall card (cached) ----
const map = fs.existsSync(MAP_FILE) ? JSON.parse(fs.readFileSync(MAP_FILE, "utf8")) : {};
const want = [...new Set(magic.map((r) => r["Product ID"]))].filter((p) => !(p in map));
const H = { headers: { "User-Agent": "CardFlip/1.0 (support@cardflip.io)", Accept: "application/json" } };
for (const [i, pid] of want.entries()) {
  try {
    const res = await fetch(`https://api.scryfall.com/cards/tcgplayer/${pid}`, H);
    if (res.status === 404) map[pid] = null;
    else if (res.ok) { const c = await res.json(); map[pid] = { id: c.id, finishes: c.finishes ?? [], name: c.name, set: c.set_name, num: c.collector_number }; }
    else throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.log(`  scryfall ${pid}: ${e.message} (left for a rerun)`);
  }
  if (i % 100 === 99) { fs.writeFileSync(MAP_FILE, JSON.stringify(map)); console.log(`  scryfall ${i + 1}/${want.length}`); }
  await new Promise((r) => setTimeout(r, 110));
}
fs.writeFileSync(MAP_FILE, JSON.stringify(map));

// ---- our catalog rows + prices ----
const { db } = await import("../src/lib/db.ts");
const { mtgCardById } = await import("../src/lib/server/mtgCards.ts");
const { quotePrice } = await import("../src/lib/listing.ts");
const user = await db.prepare("SELECT id FROM users WHERE email = ?").get(EMAIL);
if (!user) throw new Error("account not found");
const CONDITIONS = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged"];
const plan = [];
const unmatched = [];
const notes = [];
const cardMemo = new Map();
// Art Series cards carry no TCGplayer id on Scryfall: match "Art Series: FINAL FANTASY" #4 to our "Final Fantasy Art
// Series" (afin) #4 by set + number. A gold-stamped signature copy has no row of its own: the plain card, flagged.
const foldSet = (s) => s.toLowerCase().replace(/^art series:\s*/, "").replace(/^universes beyond:\s*the lord of the rings:\s*/, "").replace(/\s*art series$/, "").trim();
const artSets = new Map((await db.prepare("SELECT DISTINCT set_code, set_name FROM mtg_cards WHERE set_name LIKE '%Art Series'").all()).map((s) => [foldSet(s.set_name), s.set_code]));
// 10-24: Scryfall maps TCGplayer 662420 (Suki, Kyoshi Captain Extended Art) to Fabled Passage, so 2 copies came in as the
// wrong card (fixed by hand on Chris's yes). A match whose name is not inside TCGplayer's product name ("Battle at the
// Big Bridge - Fatal Push (Showcase)" holds "Fatal Push"; accents folded: Araña / Arana) is set aside, never added.
const foldName = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
for (const r of magic) {
  let m = map[r["Product ID"]];
  if (m?.name && !foldName(r["Product Name"]).includes(foldName(m.name.split(" // ")[0]))) {
    unmatched.push(`${r["Product Name"]} | ${r["Set Name"]} #${r.Number} (TCGplayer ${r["Product ID"]}: Scryfall says ${m.name} #${m.num}, name mismatch, set aside)`);
    continue;
  }
  if (!m && /^Art Series:/.test(r["Set Name"])) {
    const code = artSets.get(foldSet(r["Set Name"]));
    const gold = /Gold-Stamped/i.test(r["Product Name"]);
    const byNumber = (n) => (code ? db.prepare("SELECT id FROM mtg_cards WHERE set_code = ? AND collector_number = ?").get(code, n) : null);
    // 10-29: a gold-stamped copy is its own catalog row ("<n>s", scripts/sync-mtg-art.mjs twins) with its own price;
    // only where no twin exists yet does it fall back to the plain card, flagged and price-locked.
    const twin = gold ? await byNumber(`${r.Number}s`) : null;
    const hit = twin ?? (await byNumber(r.Number));
    if (hit) m = { id: hit.id, finishes: ["nonfoil"], art: true, stamped: gold && !twin };
  }
  if (!m) { unmatched.push(`${r["Product Name"]} | ${r["Set Name"]} #${r.Number} (TCGplayer ${r["Product ID"]}${m === null ? ", Scryfall has no such product" : ", lookup failed"})`); continue; }
  if (!cardMemo.has(m.id)) cardMemo.set(m.id, (await mtgCardById(m.id))[0] ?? null);
  const card = cardMemo.get(m.id);
  if (!card) { unmatched.push(`${r["Product Name"]} | ${r["Set Name"]} #${r.Number} (Scryfall ${m.id} not in our catalog)`); continue; }
  const foil = /foil/i.test(r.Printing);
  let variant = foil ? (m.finishes.includes("foil") ? "foil" : m.finishes.includes("etched") ? "etched" : "foil") : m.finishes.includes("nonfoil") ? "nonfoil" : (m.finishes[0] ?? "nonfoil");
  if ((foil && variant !== "foil") || (!foil && variant !== "nonfoil")) notes.push(`${card.name} #${card.number}: TCGplayer "${r.Printing}" -> ${variant} (the printing comes only that way)`);
  const [cond, lang] = r.Condition.split(/\s+-\s+/);
  const condition = CONDITIONS.includes(cond) ? cond : "Near Mint";
  const matchDoubt = lang
    ? `${lang} copy (TCGplayer list); priced as the English printing`
    : m.stamped
      ? "Gold-stamped signature art card (TCGplayer list); priced as the plain art card"
      : null;
  if (m.stamped) notes.push(`${card.name} art card #${card.number}: gold-stamped, flagged`);
  if (lang) notes.push(`${card.name} #${card.number}: ${r.Condition} -> ${condition}, flagged "${matchDoubt}"`);
  const market = card.prices.find((p) => p.variant === variant && p.currency === "USD")?.market ?? null;
  const q = market != null ? quotePrice(card, condition, "market", variant) : null;
  const tcg = Number(r["TCG Market Price"]) || null;
  // A gold-stamped copy has no catalog price of its own: TCGplayer's market for it, locked (the live refresh would
  // otherwise rewrite it to the plain art card's).
  const price = m.stamped && tcg ? tcg : (q?.suggested ?? (market != null ? market : tcg ?? 0));
  for (let n = 1; n <= copiesOf(r); n++) {
    plan.push({
      tcgId: r["TCGplayer Id"], n, tcg, lock: Boolean(m.stamped && tcg),
      card: {
        game: "mtg", cardName: card.name, setName: card.setName, cardNumber: card.number, imageUrl: card.imageLarge || card.imageSmall || "",
        condition, price: Math.round(price * 100) / 100, scanPrice: market, scanMarket: market, catalogCardId: card.id, rarity: card.rarity || r.Rarity || null,
        // 8 rows carry no TCGplayer Id ("-1"): their product id keys them instead (one -1 key had merged 7 of them).
        category: card.setName, verifiedAt: Date.now(), matchDoubt, variant, clientId: `tcgp-1024:${r["TCGplayer Id"] === "-1" ? `p${r["Product ID"]}-${variant}` : r["TCGplayer Id"]}:${n}`,
      },
    });
  }
}
const existing = await db.prepare("SELECT id, set_name FROM cards WHERE user_id = ? AND game = 'mtg' AND category IS NULL").all(user.id);
const cats = new Map();
for (const p of plan) cats.set(p.card.category, (cats.get(p.card.category) ?? 0) + 1);
for (const e of existing) cats.set(e.set_name, (cats.get(e.set_name) ?? 0) + 1);
const ours = plan.reduce((s, p) => s + (p.card.scanMarket ?? 0), 0);
const theirs = plan.reduce((s, p) => s + (p.tcg ?? 0), 0);
const unpriced = plan.filter((p) => p.card.scanMarket == null);
const apart = plan.filter((p, i, a) => p.n === 1 && p.card.scanMarket != null && p.tcg && Math.abs(p.card.scanMarket - p.tcg) / p.tcg > 0.25 && Math.max(p.card.scanMarket, p.tcg) >= 2);
console.log(`\nmatched copies ${plan.length}; unmatched rows ${unmatched.length}; CardFlip market total $${ours.toFixed(2)} vs TCGplayer file $${theirs.toFixed(2)}`);
console.log(`copies with no CardFlip market (file's TCGplayer price used): ${unpriced.length}`);
console.log(`categories (${cats.size}, incl. your ${existing.length} current Magic cards):`);
for (const [c, n] of [...cats].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${c}`);
if (unmatched.length) { console.log("unmatched:"); for (const u of unmatched) console.log("  " + u); }
if (notes.length) { console.log("notes:"); for (const n of notes.slice(0, 20)) console.log("  " + n); if (notes.length > 20) console.log(`  ...${notes.length - 20} more`); }
if (apart.length) { console.log(`CardFlip vs TCGplayer file >25% apart ($2+): ${apart.length}`); for (const p of apart.slice(0, 12)) console.log(`  ${p.card.cardName} (${p.card.setName} #${p.card.cardNumber} ${p.card.variant}): ours ${p.card.scanMarket} vs file ${p.tcg}`); }
fs.writeFileSync("data/import-tcgplayer-mtg-plan-2026-10-24.json", JSON.stringify({ plan: plan.map((p) => p.card), unmatched, notes }, null, 1));

if (!WRITE) { console.log("\nDRY RUN: nothing written. Add --write to add them."); process.exit(0); }
const { createCard } = await import("../src/lib/server/cards.ts");
const t0 = Date.now();
let made = 0;
for (const [i, p] of plan.entries()) {
  const row = await createCard(user.id, p.card);
  if (p.lock) await db.prepare("UPDATE cards SET price_locked = 1, price = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(p.card.price, Date.now(), row.id, user.id);
  made++;
  if (i % 200 === 199) console.log(`  written ${i + 1}/${plan.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
}
const r = await db.prepare("UPDATE cards SET category = set_name, updated_at = ? WHERE user_id = ? AND game = 'mtg' AND category IS NULL").run(Date.now(), user.id);
console.log(`\nWROTE ${made} copies in ${Math.round((Date.now() - t0) / 1000)} s; current Magic rows categorized: ${r.changes}`);
const total = await db.prepare("SELECT COUNT(*) n FROM cards WHERE user_id = ? AND game = 'mtg'").get(user.id);
console.log(`your Magic cards now: ${total.n}`);
process.exit(0);
