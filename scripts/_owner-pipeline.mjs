// Full scanner pipeline on Chris's own Pokémon scans (10-30): the photo as the phone sends it (1,024 px) → the server
// read exactly as production runs it (first read, second look / corner close-up, pattern look; lib/server/vision.ts)
// → the catalog walk the scanner does (name candidates → searchEnglishCardsLocal with the printed key) → top-1 vs the
// saved card. Owner photos only, TESTING key, local catalog. Writes nothing.
//   node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_owner-pipeline.mjs [--limit 40] [--cap 0.80]
import fs from "node:fs";
import sharp from "sharp";
import { createClient } from "@libsql/client";
import { devAnthropicKey } from "./lib/dev-key.mjs";
import { OWNER_ARGS, OWNER_JOIN } from "./lib/owner-photos.mjs";
process.env.ANTHROPIC_API_KEY = devAnthropicKey();
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const limit = Number(arg("--limit", 40)), cap = Number(arg("--cap", 0.8));
const prod = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const V = await import("../src/lib/server/vision.ts");
const E = await import("../src/lib/server/enCards.ts");
const S = await import("../src/lib/searchParams.ts");
const P = await import("../src/lib/server/photoSoftness.ts");
const RATE = { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 };
const rows = (await prod.execute({ sql: `SELECT p.card_id id, p.bytes, c.card_name, c.card_number, c.set_name, c.catalog_card_id cat FROM card_photos p JOIN cards c ON c.id = p.card_id ${OWNER_JOIN} WHERE c.game='pokemon' ORDER BY c.created_at DESC LIMIT ?`, args: [...OWNER_ARGS, limit] })).rows;
// Rows whose saved card is known to be wrong (looked at 10-30): the photo shows another card or a TCG Pocket screen.
const WRONG_TRUTH = { "Virizion#015": "photo is White Flare 010", "Fan Rotom#171": "photo is Prismatic 085", "Sylveon ex#153": "Pocket screen shot", "Sylveon ex#156": "Pocket screen shot", "Sylveon#040": "Pocket screen shot" };
let spent = 0, n = 0, top1 = 0, top3 = 0, second = 0, refused = 0, ms = 0, real = 0, realTop1 = 0;
for (const r of rows) {
  if (spent >= cap) break;
  const bytes = Buffer.isBuffer(r.bytes) ? r.bytes : Buffer.from(r.bytes);
  const small = await sharp(bytes).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const b64 = small.toString("base64");
  const soft = await P.photoSoftness(b64);
  if (P.tooSoft(soft)) { refused++; console.log(`${r.card_name} #${r.card_number}: REFUSED blurry ${JSON.stringify(soft)}`); continue; }
  const t0 = Date.now();
  const { read, usage } = await V.analyzeCardImageWithUsage(b64, "image/jpeg", "en", "pokemon", false, undefined, t0);
  const dt = Date.now() - t0; ms += dt; n++;
  spent += (usage.inputTokens * RATE.in + usage.outputTokens * RATE.out + usage.cacheReadTokens * RATE.cacheRead + usage.cacheWriteTokens * RATE.cacheWrite) / 1e6;
  if (read.secondLook) second++;
  const printed = S.printedKeyFromRead(read, "pokemon");
  let cards = [];
  for (const cand of [read.name, read.englishName].filter(Boolean)) {
    const found = (await E.searchEnglishCardsLocal(cand, printed, 24, read.artStyle ?? null, read.firstEdition ?? null)).cards;
    if (found.length) { cards = found; break; }
  }
  if (!cards.length && printed?.number && printed.setTotal) cards = (await E.searchEnglishCardsLocal("", printed, 24, null, read.firstEdition ?? null)).cards;
  const idx = cards.findIndex((c) => c.id === r.cat);
  const wrong = WRONG_TRUTH[`${r.card_name}#${r.card_number}`];
  if (idx === 0) top1++; if (idx >= 0 && idx < 3) top3++;
  if (!wrong) { real++; if (idx === 0) realTop1++; }
  const tie = cards.length > 1 && (cards[1].rankScore ?? 0) - (cards[0].rankScore ?? 0) <= 1;
  console.log(`${r.card_name} #${r.card_number} (${r.set_name})${wrong ? " [row wrong: " + wrong + "]" : ""} | read ${read.cardNumber ?? "-"}/${read.setTotal ?? "-"} ${read.setCode ?? "-"} conf ${read.confidence}${read.secondLook ? " 2nd:" + read.secondLook : ""}${read.patternLook ? " pat:" + read.patternLook : ""} | top ${cards[0] ? cards[0].setName + " #" + cards[0].number : "none"}${tie ? " (tie→picture)" : ""} | ${idx === 0 ? "✓" : idx > 0 ? "#" + (idx + 1) : "✗"} | ${dt}ms`);
}
console.log(`\n=== ${n} read (${refused} refused as blurry), spent $${spent.toFixed(3)}, avg ${Math.round(ms / n)} ms, second looks ${second}/${n} ===`);
console.log(`top-1 ${top1}/${n}, top-3 ${top3}/${n} vs the saved rows; on the ${real} rows whose saved card is right: top-1 ${realTop1}/${real}`);
