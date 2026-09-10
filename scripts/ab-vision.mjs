// A/B: Sonnet 5 (live) vs Haiku 4.5 vision on the real card photos already in prod.
// Run: npm run ab:vision -- [--limit N] [--json out.json]
// (09-06: prompt + schema now imported from vision.ts so the comparison never drifts.)
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

const MODELS = ["claude-sonnet-5", "claude-haiku-4-5"];
const PRICE = {
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-haiku-4-5": { in: 1, out: 5 },
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

// Prompt + schema: the live ones (vision.ts exports them for exactly this).
const { CARD_READ_SCHEMA, MTG_READ_SCHEMA, SYSTEM, SYSTEM_MTG } = await import("../src/lib/server/vision.ts");

async function readCard(model, b64, game) {
  const t0 = Date.now();
  const response = await anthropic.messages.create({
    model,
    max_tokens: 2000,
    output_config: { ...(model.startsWith("claude-haiku") ? {} : { effort: "low" }), format: { type: "json_schema", schema: game === "mtg" ? MTG_READ_SCHEMA : CARD_READ_SCHEMA } },
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
  "SELECT p.card_id AS id, p.bytes AS bytes, c.card_name, c.set_name, c.card_number, c.condition, c.game, c.first_edition FROM card_photos p JOIN cards c ON c.id = p.card_id ORDER BY c.created_at" + (limit ? " LIMIT " + limit : ""),
)).rows;
console.log(rows.length + " photos with ground truth. Models: " + MODELS.join(" vs ") + "\n");

const results = [];
const totals = Object.fromEntries(MODELS.map((m) => [m, { name: 0, num: 0, condAgree: 0, condRead: 0, feAgree: 0, err: 0, ms: 0, cost: 0 }]));

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
    const feAgree = Boolean(g.firstEdition) === Boolean(r.first_edition);
    if (okName) t.name++;
    if (okNum) t.num++;
    if (g.condition != null) t.condRead++;
    if (condAgree) t.condAgree++;
    if (feAgree) t.feAgree++;
    t.ms += res.ms;
    t.cost += (res.usage.in * PRICE[model].in + res.usage.out * PRICE[model].out) / 1e6;
    line.models[model] = {
      name: g.name, englishName: g.englishName, cardNumber: g.cardNumber, setTotal: g.setTotal,
      setCode: g.setCode, setName: g.setName, condition: g.condition, confidence: g.confidence, firstEdition: g.firstEdition, feAgree,
      okName, okNum, condAgree, ms: res.ms, usage: res.usage,
    };
  }
  const mark = (m) => {
    const x = line.models[m];
    if (!x || x.error) return "ERR(" + (x && x.error) + ")";
    return (x.okName ? "name✓" : "name✗ [" + x.name + (x.englishName ? " / " + x.englishName : "") + "]") +
      " " + (x.okNum ? "num✓" : "num✗ [" + x.cardNumber + "]") +
      " cond:" + (x.condition ?? "null") + (x.condAgree ? "=" : "≠") + " 1st:" + (x.feAgree ? "✓" : "✗") + " conf:" + x.confidence;
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
  console.log("  1st Edition agree: " + t.feAgree + "/" + done);
  console.log("  errors:            " + t.err);
  console.log("  avg latency:       " + (done ? Math.round(t.ms / done) : 0) + " ms");
  console.log("  total cost:        $" + t.cost.toFixed(4) + "  (per scan $" + (done ? (t.cost / done).toFixed(5) : "-") + ")");
}
if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), totals, results }, null, 2));
  console.log("\nwrote " + jsonOut);
}
