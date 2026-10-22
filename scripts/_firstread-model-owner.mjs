// Scan-cost test (Chris 10-22 "you can spend up to like $1.00, make it a decent test"): does Haiku 5.5 read Chris's own
// scans as well as Sonnet 5 at the live 1,024 px first-read size? Same live prompt + schema, owner photos only
// (scripts/lib/owner-photos.mjs), TESTING key, hard spend cap. Writes nothing to the database.
//   node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_firstread-model-owner.mjs [--cap 1.00]
import fs from "node:fs";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@libsql/client";
import { devAnthropicKey } from "./lib/dev-key.mjs";
import { OWNER_ARGS, OWNER_JOIN } from "./lib/owner-photos.mjs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const cap = Number(arg("--cap", 1.0));
const RUNS = [
  { key: "sonnet5-low", model: "claude-sonnet-5", effort: "low", rate: { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 } },
  { key: "haiku55-low", model: "claude-haiku-5-5", effort: "low", rate: { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 } },
  { key: "haiku55-medium", model: "claude-haiku-5-5", effort: "medium", rate: { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 } },
];
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const anthropic = new Anthropic({ apiKey: devAnthropicKey() });
const V = await import("../src/lib/server/vision.ts");
const schemaFor = (g) => g === "mtg" ? V.MTG_READ_SCHEMA : g === "lorcana" || g === "onepiece" ? V.TCG_READ_SCHEMA : g === "yugioh" ? V.YUGIOH_READ_SCHEMA : V.CARD_READ_SCHEMA;
const systemFor = (g) => g === "mtg" ? V.SYSTEM_MTG : g === "lorcana" ? V.SYSTEM_LORCANA : g === "onepiece" ? V.SYSTEM_ONEPIECE : g === "yugioh" ? V.SYSTEM_YUGIOH : V.SYSTEM;
const rows = (await db.execute({ sql: `SELECT p.card_id id, p.bytes, c.game, c.card_name, c.card_number, c.set_name FROM card_photos p JOIN cards c ON c.id = p.card_id ${OWNER_JOIN} ORDER BY c.game, c.created_at DESC`, args: OWNER_ARGS })).rows;
const normName = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const normNum = (s) => String(s ?? "").trim().split("/")[0].replace(/^0+(?=\d)/, "").toLowerCase();
const nameOk = (t, g) => { const a = normName(t), b = normName(g); return !!b && (a === b || a.includes(b) || b.includes(a)); };
let spent = 0; const tot = Object.fromEntries(RUNS.map((r) => [r.key, { n: 0, name: 0, num: 0, both: 0, cost: 0, ms: 0, err: 0, byGame: {} }]));
const out = [];
for (const r of rows) {
  const bytes = Buffer.isBuffer(r.bytes) ? r.bytes : Buffer.from(r.bytes);
  const b = await sharp(bytes).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  const line = { id: String(r.id).slice(0, 8), game: r.game, truth: `${r.card_name} #${r.card_number}`, set: r.set_name, reads: {} };
  for (const run of RUNS) {
    if (spent >= cap) break;
    const t0 = Date.now();
    try {
      const res = await anthropic.messages.create({
        model: run.model, max_tokens: 2000,
        output_config: { effort: run.effort, format: { type: "json_schema", schema: schemaFor(r.game) } },
        system: [{ type: "text", text: systemFor(r.game), cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b.toString("base64") } },
          { type: "text", text: "Identify this card. The seller believes it is English, but trust the photo over that if they disagree." },
        ] }],
      });
      const u = res.usage, R = run.rate;
      const cost = (u.input_tokens * R.in + u.output_tokens * R.out + (u.cache_read_input_tokens ?? 0) * R.cacheRead + (u.cache_creation_input_tokens ?? 0) * R.cacheWrite) / 1e6;
      spent += cost;
      const text = res.content.find((x) => x.type === "text");
      const g = text ? JSON.parse(text.text) : {};
      const okN = nameOk(r.card_name, g.name) || nameOk(r.card_name, g.englishName), okNum = normNum(g.cardNumber) === normNum(r.card_number);
      const t = tot[run.key]; t.n++; if (okN) t.name++; if (okNum) t.num++; if (okN && okNum) t.both++; t.cost += cost; t.ms += Date.now() - t0;
      const bg = (t.byGame[r.game] ??= { n: 0, both: 0 }); bg.n++; if (okN && okNum) bg.both++;
      line.reads[run.key] = { name: g.name, num: g.cardNumber, set: g.setName ?? g.set ?? null, okN, okNum, cost: +cost.toFixed(5), ms: Date.now() - t0 };
    } catch (e) { tot[run.key].err++; line.reads[run.key] = { error: String(e.message || e).slice(0, 100) }; }
  }
  console.log(`${line.game} ${line.truth} | ` + RUNS.map((run) => { const x = line.reads[run.key]; return x ? `${run.key}: ${x.error ? "ERR " + x.error : (x.okN ? "name✓" : "name✗[" + x.name + "]") + " " + (x.okNum ? "num✓" : "num✗[" + x.num + "]") + " " + x.ms + "ms"}` : `${run.key}: skipped`; }).join(" | "));
  out.push(line);
  if (spent >= cap) { console.log(`spend cap $${cap} reached`); break; }
}
console.log(`\n=== ${out.length} photos, spent $${spent.toFixed(3)} ===`);
for (const run of RUNS) { const t = tot[run.key]; console.log(`${run.key.padEnd(15)} n=${t.n} name ${t.name}/${t.n} number ${t.num}/${t.n} both ${t.both}/${t.n} | $${t.n ? (t.cost / t.n).toFixed(4) : "-"}/read | ${t.n ? Math.round(t.ms / t.n) : 0} ms | err ${t.err} | ` + Object.entries(t.byGame).map(([g, v]) => `${g} ${v.both}/${v.n}`).join(", ")); }
fs.writeFileSync("data/firstread-model-owner-2026-10-22.json", JSON.stringify({ runs: RUNS.map((r) => ({ key: r.key, model: r.model, effort: r.effort })), spent, totals: tot, lines: out }, null, 1));
