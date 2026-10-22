// Scan-cost test (Chris 10-22 "yes do the scan cost test"): does a SMALLER first-read picture identify Chris's own scans
// as well as the full one? Sonnet 5, live prompt + schema, three sizes of the same photo. Owner photos only
// (scripts/lib/owner-photos.mjs), TESTING key, hard spend cap. Writes nothing to the database.
//   node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_firstread-size-owner.mjs [--game pokemon|mtg] [--limit 20] [--cap 0.50] [--sizes full,1024,768]
import fs from "node:fs";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@libsql/client";
import { devAnthropicKey } from "./lib/dev-key.mjs";
import { OWNER_ARGS, OWNER_JOIN } from "./lib/owner-photos.mjs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const limit = Number(arg("--limit", 20)), cap = Number(arg("--cap", 0.5));
const sizes = arg("--sizes", "full,1024,768").split(",");
const MODEL = "claude-sonnet-5", RATE = { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 };
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const anthropic = new Anthropic({ apiKey: devAnthropicKey() });
const V = await import("../src/lib/server/vision.ts");
const schemaFor = (g) => g === "mtg" ? V.MTG_READ_SCHEMA : g === "lorcana" || g === "onepiece" ? V.TCG_READ_SCHEMA : g === "yugioh" ? V.YUGIOH_READ_SCHEMA : V.CARD_READ_SCHEMA;
const systemFor = (g) => g === "mtg" ? V.SYSTEM_MTG : g === "lorcana" ? V.SYSTEM_LORCANA : g === "onepiece" ? V.SYSTEM_ONEPIECE : g === "yugioh" ? V.SYSTEM_YUGIOH : V.SYSTEM;
const rows = (await db.execute({ sql: `SELECT p.card_id id, p.bytes, c.game, c.card_name, c.card_number, c.set_name, c.created_at FROM card_photos p JOIN cards c ON c.id = p.card_id ${OWNER_JOIN} WHERE c.game = ? ORDER BY c.created_at DESC LIMIT ?`, args: [...OWNER_ARGS, arg("--game", "pokemon"), limit] })).rows;
const normName = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const normNum = (s) => String(s ?? "").trim().split("/")[0].replace(/^0+(?=\d)/, "").toLowerCase();
const nameOk = (t, g) => { const a = normName(t), b = normName(g); return !!b && (a === b || a.includes(b) || b.includes(a)); };
let spent = 0; const tot = Object.fromEntries(sizes.map((s) => [s, { n: 0, name: 0, num: 0, both: 0, inTok: 0, cost: 0, ms: 0, err: 0 }]));
const out = [];
for (const r of rows) {
  const bytes = Buffer.isBuffer(r.bytes) ? r.bytes : Buffer.from(r.bytes);
  const meta = await sharp(bytes).metadata();
  const line = { id: String(r.id).slice(0, 8), game: r.game, truth: `${r.card_name} #${r.card_number}`, size: `${meta.width}x${meta.height}`, reads: {} };
  for (const s of sizes) {
    if (spent >= cap) break;
    const b = s === "full" ? bytes : await sharp(bytes).resize({ width: Number(s), height: Number(s), fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    const t0 = Date.now();
    try {
      const res = await anthropic.messages.create({
        model: MODEL, max_tokens: 2000,
        output_config: { effort: "low", format: { type: "json_schema", schema: schemaFor(r.game) } },
        system: [{ type: "text", text: systemFor(r.game), cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b.toString("base64") } },
          { type: "text", text: "Identify this card. The seller believes it is English, but trust the photo over that if they disagree." },
        ] }],
      });
      const u = res.usage;
      const cost = (u.input_tokens * RATE.in + u.output_tokens * RATE.out + (u.cache_read_input_tokens ?? 0) * RATE.cacheRead + (u.cache_creation_input_tokens ?? 0) * RATE.cacheWrite) / 1e6;
      spent += cost;
      const text = res.content.find((x) => x.type === "text");
      const g = text ? JSON.parse(text.text) : {};
      const okN = nameOk(r.card_name, g.name) || nameOk(r.card_name, g.englishName), okNum = normNum(g.cardNumber) === normNum(r.card_number);
      const t = tot[s]; t.n++; if (okN) t.name++; if (okNum) t.num++; if (okN && okNum) t.both++; t.inTok += u.input_tokens; t.cost += cost; t.ms += Date.now() - t0;
      line.reads[s] = { name: g.name, num: g.cardNumber, okN, okNum, inTok: u.input_tokens, kb: Math.round(b.length / 1024), cost: +cost.toFixed(4) };
    } catch (e) { tot[s].err++; line.reads[s] = { error: String(e.message || e).slice(0, 80) }; }
  }
  console.log(`${line.game} ${line.truth} (${line.size}) | ` + sizes.map((s) => { const x = line.reads[s]; return x ? `${s}: ${x.error ? "ERR " + x.error : (x.okN ? "name✓" : "name✗[" + x.name + "]") + " " + (x.okNum ? "num✓" : "num✗[" + x.num + "]") + " " + x.inTok + "tok " + x.kb + "KB"}` : `${s}: skipped`; }).join(" | "));
  out.push(line);
  if (spent >= cap) { console.log(`spend cap $${cap} reached`); break; }
}
console.log(`\n=== ${MODEL}, ${out.length} photos, spent $${spent.toFixed(3)} ===`);
for (const s of sizes) { const t = tot[s]; console.log(`${s.padEnd(5)} n=${t.n} name ${t.name}/${t.n} number ${t.num}/${t.n} both ${t.both}/${t.n} | avg image-side input ${t.n ? Math.round(t.inTok / t.n) : 0} tok | $${t.n ? (t.cost / t.n).toFixed(4) : "-"}/read | ${t.n ? Math.round(t.ms / t.n) : 0} ms | err ${t.err}`); }
fs.writeFileSync(`data/firstread-size-owner-2026-10-22-${arg("--game", "pokemon")}.json`, JSON.stringify({ model: MODEL, spent, totals: tot, lines: out }, null, 1));
