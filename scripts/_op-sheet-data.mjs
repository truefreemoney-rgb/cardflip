// Builds the One Piece printings dry-run sample sheet data (samples + inline thumbnails) from a rehearsal copy of the mirror (10-25).
//   node --experimental-strip-types --no-warnings scripts/_op-sheet-data.mjs <rehearsal.db> <plan-apply.json> <pic-changes.jsonl> <out.json>   (cwd = cardflip repo)
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { printingLabel } from "../src/lib/onepiece.ts";
const sharp = createRequire("C:/Users/Chris/cardflip/package.json")("sharp");

const [dbPath, planPath, picPath, outPath] = process.argv.slice(2);
const db = new DatabaseSync(dbPath, { readOnly: true });
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const pics = fs.readFileSync(picPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const row = (id) => db.prepare("SELECT id, name, collector_number, set_code, set_name, rarity, variant, price_usd, image_url, ref_image_url, tcg_product_id FROM tcg_cards WHERE id = ?").get(id);
const UA = { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)" };
const cache = new Map();
async function thumb(url) {
  if (!url) return null;
  const small = url.replace(/_in_1000x1000\.jpg.*$/, "_200w.jpg");
  if (cache.has(small)) return cache.get(small);
  try {
    const res = await fetch(small, { headers: UA, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(String(res.status));
    const buf = Buffer.from(await res.arrayBuffer());
    const out = await sharp(buf).resize({ width: 180 }).jpeg({ quality: 72 }).toBuffer();
    const uri = `data:image/jpeg;base64,${out.toString("base64")}`;
    cache.set(small, uri);
    return uri;
  } catch (e) {
    console.log("  !! picture", small, e.message);
    cache.set(small, null);
    return null;
  }
}
const label = (r) => printingLabel({ rarity: r.rarity, variant: r.variant, setCode: r.set_code, name: r.name, setName: r.set_name });
const card = async (r, extra = {}) => ({ id: r.id, name: r.name, number: r.collector_number, set: r.set_name, printing: label(r), usd: r.price_usd, img: await thumb(r.image_url), ...extra });

const adds = plan.add.map((a) => row(a.id)).filter(Boolean);
const stampKind = (v) => /^(super-pre-release|pre-release|release-event|anniversary)/.exec(v ?? "")?.[1] ?? null;
const pickTop = (list, n) => [...list].sort((a, b) => (b.price_usd ?? 0) - (a.price_usd ?? 0)).slice(0, n);
const sections = [];

// 1. Stamped copies: one high and one everyday card per kind.
const stamps = [];
for (const k of ["release-event", "pre-release", "anniversary", "super-pre-release"]) {
  const of = adds.filter((r) => stampKind(r.variant) === k && r.set_code !== "PROMO");
  const top = pickTop(of, 2);
  const everyday = of.filter((r) => r.price_usd != null && r.price_usd < 2).slice(0, 1);
  stamps.push(...top, ...everyday);
}
const kd = row("OP17-006#tcg712668");
if (kd && !stamps.some((r) => r.id === kd.id)) stamps.unshift(kd);
sections.push({ key: "stamps", title: "Event-stamped copies", note: "Release event, pre-release, anniversary and super pre-release cards. Same art as the booster card with a stamp in the corner. They sit under the booster's set.", count: adds.filter((r) => stampKind(r.variant) && r.set_code !== "PROMO").length, cards: await Promise.all(stamps.slice(0, 10).map((r) => card(r, { base: row(r.collector_number) ? { usd: row(r.collector_number).price_usd } : null, borrowed: !String(r.image_url).includes(`/product/${r.tcg_product_id}_`) }))) });

// 2. Promos.
const promos = adds.filter((r) => r.set_code === "PROMO");
sections.push({ key: "promos", title: "Promos", note: "Event, judge, tournament and winner cards we had no row for. They sit under One Piece Promotion Cards.", count: promos.length, cards: await Promise.all(pickTop(promos, 8).map((r) => card(r))) });

// 3. Special printings inside a set (manga, SP gold, alt arts...).
const special = adds.filter((r) => !stampKind(r.variant) && r.set_code !== "PROMO" && r.variant && r.variant !== "reprint");
sections.push({ key: "special", title: "Special printings", note: "Manga, SP gold, alternate arts and other printings of a set card that TCGplayer sells on their own.", count: special.length, cards: await Promise.all(pickTop(special, 8).map((r) => card(r))) });

// 4. Deck sets and other reprints.
const reprints = adds.filter((r) => !stampKind(r.variant) && r.set_code !== "PROMO" && (r.variant === "reprint" || !r.variant));
const deckPick = [];
for (const code of ["LT01", "SD01", "OPDD", "OPRP"]) deckPick.push(...pickTop(reprints.filter((r) => r.set_code === code), 1));
sections.push({ key: "decks", title: "Deck sets and reprints", note: "Learn Together Deck Set, Set Sail Deck Set, Demo Deck and Revision Pack cards, each under its own set.", count: reprints.length, cards: await Promise.all(deckPick.map((r) => card(r))) });

// 5. Rows we already had that get their TCGplayer price and picture.
const linkedIds = ["OP05-091#promo", "OP01-015_pr4#promo", "OP01-015_pr3#promo", "OP01-015#promo", "OP07-064_pr1#promo"];
const linked = [];
for (const id of linkedIds) {
  const r = row(id);
  if (!r) continue;
  // `was` is null for a row that had no price (Rebecca): a ?? chain would fall through to the rehearsal's new price.
  const entry = plan.priceChanges.find((c) => c.id === id) ?? plan.held.find((c) => c.id === id) ?? plan.linked.find((l) => l.id === id);
  const was = entry ? entry.was : r.price_usd;
  const after = pics.find((p) => p.id === id)?.to ?? r.image_url;
  linked.push({ ...(await card({ ...r, image_url: after })), was });
}
sections.push({ key: "linked", title: "Cards we had, now tied to TCGplayer", note: "These rows had no TCGplayer product. Now each one shows that product's price and photo.", count: plan.counts.how.linked, cards: linked });

// 6. Wrong pictures fixed.
const moved = [];
for (const m of plan.moved) {
  const r = row(m.id);
  if (!r) continue;
  moved.push({ ...(await card({ ...r, image_url: pics.find((p) => p.id === m.id)?.to ?? r.image_url })), before: await thumb(m.picture) });
}
sections.push({ key: "moved", title: "Wrong pictures fixed", note: "These showed another printing's picture. Left: today. Right: after.", count: moved.length, cards: moved });

// 7. Held for my hand check.
const held = pickTop(plan.held.map((h) => ({ ...h, price_usd: Math.max(h.was ?? 0, h.usd ?? 0) })), 10);
const heldCards = [];
for (const h of held) {
  const r = row(h.id);
  if (!r) continue;
  heldCards.push({ ...(await card({ ...r, image_url: `https://tcgplayer-cdn.tcgplayer.com/product/${h.productId}_in_1000x1000.jpg` })), was: h.was, tcg: h.usd });
}
sections.push({ key: "held", title: "Held for my hand check", note: "TCGplayer's number is far from ours on these. They keep today's price until I check real sales.", count: plan.held.length, cards: heldCards });

const counts = plan.counts;
const byKind = { stamps: sections[0].count, promos: promos.length, special: special.length, decks: reprints.length };
fs.writeFileSync(outPath, JSON.stringify({ at: plan.at, counts, byKind, waiting: plan.waiting?.length ?? 0, pictures: pics.length, promoPictures: pics.filter((p) => p.id.includes("#promo")).length, sections }, null, 0));
console.log("sections:", sections.map((s) => `${s.key} ${s.cards.length}/${s.count}`).join(", "), "| bytes", fs.statSync(outPath).size);
