// Replay real scans: pull a card's stored photo from prod, run the same
// vision read the scanner runs (model, effort, prompt, schema), then rank it
// against the LOCAL mirror the way the scanner does — so a misidentification
// Chris reports can be reproduced and a ranking change checked against the
// actual reads, not guesses.
//
//   node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/replay-scans.mjs <cardId>... [--cache file.json]
//
// --cache: reads are saved/loaded from this JSON so a ranking tweak can be
// re-run without paying for vision again. Reads prod Turso and the Anthropic
// API; writes nothing to any database.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import Anthropic from "@anthropic-ai/sdk";

const root = process.cwd();
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { searchEnglishCardsLocal } = await import(at("lib/server/enCards.ts"));
const { searchMtgCardsLocal } = await import(at("lib/server/mtgCards.ts"));
const { isSecretRareNumber } = await import(at("lib/cardNumber.ts"));
const VISION_MODEL = fs.readFileSync(new URL("../src/lib/server/vision.ts", import.meta.url), "utf8").match(/VISION_MODEL = "([^"]+)"/)[1];

const args = process.argv.slice(2);
const cacheArg = args.indexOf("--cache");
const cachePath = cacheArg > -1 ? args[cacheArg + 1] : null;
// --file <image> [--game mtg]: replay a local photo instead of a prod row.
const fileArg = args.indexOf("--file");
const filePath = fileArg > -1 ? args[fileArg + 1] : null;
const gameArg = args.indexOf("--game");
const fileGame = gameArg > -1 ? args[gameArg + 1] : "pokemon";
const skip = new Set([cacheArg + 1, fileArg + 1, gameArg + 1]);
const ids = args.filter((a, i) => !a.startsWith("--") && !skip.has(i));
const cache = cachePath && fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : {};

const env = {};
for (const line of fs.readFileSync(path.join(root, ".env.vercel.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)="?(.*?)"?$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
const cfg = JSON.parse(fs.readFileSync(path.join(root, ".env.migration.json"), "utf8").replace(/^﻿/, ""));
const prod = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// Schema + system prompt: same shape as src/lib/server/vision.ts (kept in
// step by hand — vision.ts is server-only and not importable here).
const nullableString = (description) => ({ anyOf: [{ type: "string" }, { type: "null" }], description });
const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "The Pokémon/card name exactly as printed on the card, in the card's own script. Do not translate." },
    englishName: nullableString("The English species name when the card is Japanese or Chinese (e.g. ピカチュウ -> Pikachu). Null for English cards."),
    setName: nullableString("The set or expansion name if identifiable, else null."),
    cardNumber: nullableString("The collector number — the left half of the fraction at the bottom of the card, keeping any letter prefix. From '199/165' return '199'; from 'SV49/SV94' return 'SV49'; from 'TG12/TG30' return 'TG12'. Null if not visible."),
    setTotal: { anyOf: [{ type: "integer" }, { type: "null" }], description: "The right half of that fraction — the set's card count. From '199/165' return 165; a lettered denominator like 'SV94' or 'TG30' means 94 or 30. This identifies which expansion the card is from, so read it separately and carefully. Null if the card prints no denominator (promos often don't) or you cannot see it." },
    setCode: nullableString("The short expansion code printed near the collector number, e.g. 'SVI', 'PAF', 'BS'. This is NOT the language code ('EN'), the illustrator, or the regulation mark (a single letter in a black box). Null if not visible."),
    artStyle: { anyOf: [{ type: "string", enum: ["standard", "full-art"] }, { type: "null" }], description: "How the card is framed. 'standard': the illustration sits in a box in the upper half and the attacks/text sit on a plain panel below. 'full-art': the illustration covers the whole card and the text is printed over it (full art, illustration rare, special illustration rare, VMAX/VSTAR/ex full-art, gold/rainbow). Null if you can't tell." },
    language: { type: "string", enum: ["en", "ja", "zh"], description: "The language the card is printed in." },
    condition: { anyOf: [{ type: "string", enum: ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged"] }, { type: "null" }], description: "Condition judged from this photo. Null when the photo is too blurry, dark, or angled to judge." },
    conditionNotes: nullableString("One short sentence on what drove the condition call — visible edge whitening, off-centering, surface scratches, creases. Null when condition is null."),
    confidence: { type: "number", description: "0 to 1, how confident you are in the name and number specifically." },
    kind: { anyOf: [{ type: "string", enum: ["card", "token", "art"] }, { type: "null" }], description: "What kind of object this is. 'token': the type line says Token (e.g. 'Token Creature — Hero'), or the number starts with T. 'art': an Art Series / art card — the illustration fills the whole card with only a name and artist credit along the bottom, no rules text, no mana cost or HP. 'card': a normal playable card. Null if unsure." },
  },
  required: ["name", "englishName", "setName", "cardNumber", "setTotal", "setCode", "artStyle", "language", "condition", "conditionNotes", "confidence", "kind"],
  additionalProperties: false,
};
const visionSrc = fs.readFileSync(path.join(root, "src/lib/server/vision.ts"), "utf8");
const SYSTEM = visionSrc.match(/const SYSTEM = `([\s\S]*?)`;/)[1];
// Magic (09-03 MTG stress test): same schema, the MTG system prompt, and the
// mirror's own search (name + collector number + printed set code).
const SYSTEM_MTG = visionSrc.match(/const SYSTEM_MTG = `([\s\S]*?)`;/)[1];

async function readCard(b64, game) {
  const response = await anthropic.messages.create({
    model: VISION_MODEL,
    max_tokens: 2000,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: game === "mtg" ? SYSTEM_MTG : SYSTEM,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
        { type: "text", text: "Identify this card. The seller believes it is English, but trust the photo over that if they disagree." },
      ],
    }],
  });
  const text = response.content.find((b) => b.type === "text");
  return text ? JSON.parse(text.text) : null;
}

if (filePath) {
  const b64 = fs.readFileSync(filePath).toString("base64");
  const read = await readCard(b64, fileGame);
  console.log(`\n## [${fileGame}] ${path.basename(filePath)}`);
  console.log(`read: name=${read.name} number=${read.cardNumber} total=${read.setTotal} code=${read.setCode} art=${read.artStyle} kind=${read.kind} conf=${read.confidence}`);
  const names = [read.name, read.englishName].filter(Boolean);
  for (const candidate of names) {
    const code = read.kind === "art" && read.setCode && !read.setCode.toUpperCase().startsWith("A") ? `A${read.setCode}` : read.setCode;
    const found =
      fileGame === "mtg"
        ? await searchMtgCardsLocal(candidate, read.cardNumber || null, code || null, 5, read.kind === "art" ? "full-art" : (read.artStyle ?? null), read.kind === "art")
        : (await searchEnglishCardsLocal(candidate, read.cardNumber ? { number: read.cardNumber, setTotal: read.setTotal, setCode: read.setCode, isSecretRare: false } : null, 5, read.artStyle ?? null)).cards;
    for (const [i, c] of found.slice(0, 4).entries()) console.log(`  ${i === 0 ? "→" : " "} ${c.name} · ${c.setName} ${c.number} [${c.setCode ?? ""}] ${c.id}`);
    if (found.length) break;
  }
}

for (const id of ids) {
  const row = (await prod.execute({
    sql: "SELECT c.card_name, c.set_name, c.card_number, c.catalog_card_id, c.game, ph.bytes FROM cards c JOIN card_photos ph ON ph.card_id = c.id WHERE c.id = ?",
    args: [id],
  })).rows[0];
  if (!row) { console.log(`\n## ${id}: no photo`); continue; }
  let read = cache[id];
  if (!read) {
    const b64 = Buffer.from(row.bytes).toString("base64");
    read = await readCard(b64, row.game === "mtg" ? "mtg" : "pokemon");
    cache[id] = read;
    if (cachePath) fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1));
  }
  const game = row.game === "mtg" ? "mtg" : "pokemon";
  console.log(`\n## [${game}] ${row.card_name} — scanner chose ${row.set_name} ${row.card_number} (${row.catalog_card_id})`);
  console.log(`read: name=${read.name} number=${read.cardNumber} total=${read.setTotal} code=${read.setCode} art=${read.artStyle} kind=${read.kind ?? "-"} conf=${read.confidence}`);

  // Same walk as src/app/app/page.tsx: name candidates, printed fraction, art.
  const printed = read.cardNumber
    ? { number: read.cardNumber, setTotal: read.setTotal, setCode: read.setCode, isSecretRare: isSecretRareNumber(read.cardNumber, read.setTotal) }
    : null;
  const names = [read.name, read.englishName].filter(Boolean);
  let matches = [];
  for (const candidate of names) {
    const found =
      game === "mtg"
        ? await searchMtgCardsLocal(candidate, read.cardNumber || null, read.setCode || null, 5, read.kind === "art" ? "full-art" : (read.artStyle ?? null), read.kind === "art")
        : (await searchEnglishCardsLocal(candidate, printed, 5, read.artStyle ?? null)).cards;
    if (found.length === 0) continue;
    if (matches.length === 0) matches = found;
    if (found[0].name.trim().toLowerCase() === candidate.trim().toLowerCase()) { matches = found; break; }
  }
  for (const [i, c] of matches.slice(0, 4).entries()) {
    console.log(`  ${i === 0 ? "→" : " "} ${c.name} · ${c.setName} ${c.number}/${c.setTotal ?? "?"} [${c.setCode ?? ""}] ${c.id}`);
  }
}
