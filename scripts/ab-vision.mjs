// A/B: Sonnet 5 vs Opus 5 vision on the real card photos already in prod.
//
//   node scripts/ab-vision.mjs [--limit N] [--json out.json]
//
// Margin question (STATE.md 09-01): identification runs on claude-opus-5
// today; Sonnet 5 is $2/$10 per MTok vs Opus's $5/$25. If Sonnet reads the
// same photos as well as Opus, scan cost roughly halves. Test set is every
// row in card_photos joined to its card — the card row's name/number/set
// are what the seller accepted at scan time, so they serve as ground truth
// for identification; condition is scored as agreement (the stored value
// came from Opus, so it is not neutral truth).
//
// Same system prompt, schema, effort and user turn as src/lib/server/vision.ts
// — this measures the model swap alone. Reads prod Turso and calls the
// Anthropic API only; writes nothing to the database.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import Anthropic from "@anthropic-ai/sdk";

const MODELS = ["claude-opus-5", "claude-sonnet-5"];
const PRICE = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 2, out: 10 },
};

const root = process.cwd();
const env = {};
for (const line of fs.readFileSync(path.join(root, ".env.vercel.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)="?(.*?)"?$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
if (!env.ANTHROPIC_API_KEY) { console.error("missing ANTHROPIC_API_KEY in .env.vercel.local"); process.exit(1); }
// .env.vercel.local's TURSO_DATABASE_URL points at the old cardflip-cardflipper
// db (404s); .env.migration.json holds the live cardflip-christophis creds.
const cfg = JSON.parse(fs.readFileSync(path.join(root, ".env.migration.json"), "utf8").replace(/^﻿/, ""));

const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 0;
const jsonArg = process.argv.indexOf("--json");
const jsonOut = jsonArg > -1 ? process.argv[jsonArg + 1] : null;

const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// --- schema + prompts, verbatim from src/lib/server/vision.ts ---
const nullableString = (description) => ({ anyOf: [{ type: "string" }, { type: "null" }], description });
const CARD_READ_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "The Pokémon/card name exactly as printed on the card, in the card's own script. Do not translate." },
    englishName: nullableString("The English species name when the card is Japanese or Chinese (e.g. ピカチュウ -> Pikachu). Null for English cards."),
    setName: nullableString("The set or expansion name if identifiable, else null."),
    cardNumber: nullableString("The collector number — the left half of the fraction at the bottom of the card. From '199/165' return '199'. Null if not visible."),
    setTotal: { anyOf: [{ type: "integer" }, { type: "null" }], description: "The right half of that fraction — the set's card count. From '199/165' return 165. This identifies which expansion the card is from, so read it separately and carefully. Null if the card prints no denominator (promos often don't) or you cannot see it." },
    setCode: nullableString("The short expansion code printed near the collector number, e.g. 'SVI', 'PAF', 'BS'. This is NOT the language code ('EN'), the illustrator, or the regulation mark (a single letter in a black box). Null if not visible."),
    artStyle: { anyOf: [{ type: "string", enum: ["standard", "full-art"] }, { type: "null" }], description: "How the card is framed. 'standard': the illustration sits in a box in the upper half and the attacks/text sit on a plain panel below. 'full-art': the illustration covers the whole card and the text is printed over it (full art, illustration rare, special illustration rare, VMAX/VSTAR/ex full-art, gold/rainbow). Null if you can't tell." },
    language: { type: "string", enum: ["en", "ja", "zh"], description: "The language the card is printed in." },
    condition: { anyOf: [{ type: "string", enum: ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged"] }, { type: "null" }], description: "Condition judged from this photo. Null when the photo is too blurry, dark, or angled to judge." },
    conditionNotes: nullableString("One short sentence on what drove the condition call — visible edge whitening, off-centering, surface scratches, creases. Null when condition is null."),
    confidence: { type: "number", description: "0 to 1, how confident you are in the name and number specifically." },
  },
  required: ["name", "englishName", "setName", "cardNumber", "setTotal", "setCode", "artStyle", "language", "condition", "conditionNotes", "confidence"],
  additionalProperties: false,
};

const SYSTEM = `You identify Pokémon trading cards from photos for a seller who is about to list them.

Read what is actually on the card. The name and the full collector fraction are
what the lookup keys on, so getting those exactly right matters more than
filling in every other field — return null rather than a guess for anything you
cannot actually see, and let confidence reflect that.

Both halves of the fraction matter, and they answer different questions. The
left half says which card this is; the right half says which set it came from,
and that is what separates an original from a reprint carrying the same name
and the same number — Charizard 4/102 is the 1999 Base Set card, Charizard
4/130 is the 2000 reprint worth roughly half. A number above the set total
(201/198) is a secret rare, which is normal and usually the valuable one. Read
the two halves independently rather than assuming a card is numbered within
its set.

Photos are phone snapshots: angled, glare, uneven light, sometimes still in a
sleeve. Judge condition only from what the photo can actually support. Glare is
not a scratch and a sleeve is not damage; when the photo cannot settle it, say
so with a null rather than defaulting to Near Mint.`;

const SYSTEM_MTG = `You identify Magic: The Gathering cards from photos for a seller who is about to list them.

Read what is actually on the card. The lookup keys on three things printed on
every modern card: the name (top-left of the frame), the collector number and
the set code — both in the bottom-left corner in small type, e.g.
"0187/0281 R  LTR • EN" or on older cards "187/281" with the set code on the
next line, or just "187" on very old cards. Return the collector number as
printed without leading zeros ("187"; keep suffix letters like "187a" or the ★),
the denominator as setTotal when printed, and the 3–5 character set code
("LTR", "MH2", "2X2", "PLST") as setCode. The set code is NOT the language
code ("EN"), NOT the rarity letter (C/U/R/M) that sits between number and code,
and NOT the artist credit. Put the full name in "name" exactly as printed; for a
double-faced or adventure card use the front/main name. Leave englishName null.
setName is optional — the set code is what identifies the printing.

Photos are phone snapshots: angled, glare, uneven light, sometimes still in a
sleeve. Judge condition only from what the photo can actually support. Glare is
not a scratch and a sleeve is not damage; when the photo cannot settle it, say
so with a null rather than defaulting to Near Mint. Foil treatment is not a
condition issue.`;
// --- end verbatim ---

async function readCard(model, b64, game) {
  const t0 = Date.now();
  const response = await anthropic.messages.create({
    model,
    max_tokens: 2000,
    output_config: { effort: "low", format: { type: "json_schema", schema: CARD_READ_SCHEMA } },
    system: game === "mtg" ? SYSTEM_MTG : SYSTEM,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
        { type: "text", text: "Identify this card. The seller believes it is English, but trust the photo over that if they disagree." },
      ],
    }],
  });
  const ms = Date.now() - t0;
  if (response.stop_reason === "refusal") return { error: "refusal", ms };
  const text = response.content.find((b) => b.type === "text");
  if (!text) return { error: "no text block", ms };
  const parsed = JSON.parse(text.text);
  return { read: parsed, ms, usage: { in: response.usage.input_tokens, out: response.usage.output_tokens } };
}

// Loose-but-honest matchers: what the lookup pipeline would tolerate.
const normName = (s) => String(s ?? "").toLowerCase().replace(/[\s　]+/g, " ").trim();
const normNum = (s) => String(s ?? "").trim().replace(/^0+(?=\d)/, "").toLowerCase();
const nameMatches = (truth, got) => {
  if (!got) return false;
  const a = normName(truth), b = normName(got);
  return a === b || a.includes(b) || b.includes(a);
};

const rows = (await db.execute(
  "SELECT p.card_id AS id, p.bytes AS bytes, c.card_name, c.set_name, c.card_number, c.condition, c.game FROM card_photos p JOIN cards c ON c.id = p.card_id ORDER BY c.created_at" + (limit ? " LIMIT " + limit : ""),
)).rows;
console.log(rows.length + " photos with ground truth. Models: " + MODELS.join(" vs ") + "\n");

const results = [];
const totals = Object.fromEntries(MODELS.map((m) => [m, { name: 0, num: 0, condAgree: 0, condRead: 0, err: 0, ms: 0, cost: 0 }]));

for (const r of rows) {
  const bytes = Buffer.isBuffer(r.bytes) ? r.bytes : Buffer.from(r.bytes);
  const b64 = bytes.toString("base64");
  const truthNum = normNum(String(r.card_number).split("/")[0]);
  const line = { id: String(r.id).slice(0, 8), truth: { name: r.card_name, number: r.card_number, set: r.set_name, condition: r.condition }, game: r.game, models: {} };
  const [a, b] = await Promise.all(MODELS.map((m) => readCard(m, b64, r.game).catch((e) => ({ error: String(e && e.message || e), ms: 0 }))));
  for (const [model, res] of [[MODELS[0], a], [MODELS[1], b]]) {
    const t = totals[model];
    if (res.error || !res.read) {
      t.err++;
      line.models[model] = { error: res.error };
      continue;
    }
    const g = res.read;
    const okName = nameMatches(r.card_name, g.name) || nameMatches(r.card_name, g.englishName);
    const okNum = normNum(g.cardNumber) === truthNum;
    const condAgree = g.condition != null && g.condition === r.condition;
    if (okName) t.name++;
    if (okNum) t.num++;
    if (g.condition != null) t.condRead++;
    if (condAgree) t.condAgree++;
    t.ms += res.ms;
    t.cost += (res.usage.in * PRICE[model].in + res.usage.out * PRICE[model].out) / 1e6;
    line.models[model] = {
      name: g.name, englishName: g.englishName, cardNumber: g.cardNumber, setTotal: g.setTotal,
      setCode: g.setCode, setName: g.setName, condition: g.condition, confidence: g.confidence,
      okName, okNum, condAgree, ms: res.ms, usage: res.usage,
    };
  }
  const mark = (m) => {
    const x = line.models[m];
    if (!x || x.error) return "ERR(" + (x && x.error) + ")";
    return (x.okName ? "name✓" : "name✗ [" + x.name + (x.englishName ? " / " + x.englishName : "") + "]") +
      " " + (x.okNum ? "num✓" : "num✗ [" + x.cardNumber + "]") +
      " cond:" + (x.condition ?? "null") + (x.condAgree ? "=" : "≠") + " conf:" + x.confidence;
  };
  console.log(line.id + "  " + r.card_name + " #" + r.card_number + " (" + r.condition + ", " + r.game + ")");
  for (const m of MODELS) console.log("    " + m.padEnd(16) + mark(m));
  results.push(line);
}

const n = rows.length;
console.log("\n=== Summary over " + n + " photos ===");
for (const m of MODELS) {
  const t = totals[m];
  const done = n - t.err;
  console.log(m + ":");
  console.log("  name correct:      " + t.name + "/" + done);
  console.log("  number correct:    " + t.num + "/" + done);
  console.log("  condition read:    " + t.condRead + "/" + done + " (agree with stored: " + t.condAgree + ")");
  console.log("  errors:            " + t.err);
  console.log("  avg latency:       " + (done ? Math.round(t.ms / done) : 0) + " ms");
  console.log("  total cost:        $" + t.cost.toFixed(4) + "  (per scan $" + (done ? (t.cost / done).toFixed(5) : "-") + ")");
}
if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), totals, results }, null, 2));
  console.log("\nwrote " + jsonOut);
}
