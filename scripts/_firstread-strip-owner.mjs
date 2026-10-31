// Number-read test (Chris 10-30 "read and recognize the number better", "cut down the second-look retries"): does a
// bottom-strip close-up beside the whole card in the FIRST read get the number right more often, and how many
// second looks does it save? Sonnet 5, the live prompt + schema via vision.ts firstReadContent, same photo per arm.
// Owner photos only (scripts/lib/owner-photos.mjs), TESTING key, hard spend cap. Writes nothing to the database.
//   node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_firstread-strip-owner.mjs [--limit 40] [--cap 1.50] [--widths 0,1000,1400]
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@libsql/client";
import { devAnthropicKey } from "./lib/dev-key.mjs";
import { OWNER_ARGS, OWNER_JOIN } from "./lib/owner-photos.mjs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const limit = Number(arg("--limit", 40)), cap = Number(arg("--cap", 1.5));
const widths = arg("--widths", "0,1000,1400").split(",").map(Number);
const MODEL = "claude-sonnet-5", RATE = { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 };
const SECOND_LOOK_CONFIDENCE = 0.7;
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const anthropic = new Anthropic({ apiKey: devAnthropicKey() });
const V = await import("../src/lib/server/vision.ts");
const rows = (await db.execute({ sql: `SELECT p.card_id id, p.bytes, c.game, c.card_name, c.card_number, c.set_name, c.created_at FROM card_photos p JOIN cards c ON c.id = p.card_id ${OWNER_JOIN} WHERE c.game = 'pokemon' ORDER BY c.created_at DESC LIMIT ?`, args: [...OWNER_ARGS, limit] })).rows;
const normName = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const normNum = (s) => String(s ?? "").trim().split("/")[0].replace(/\s+/g, "").replace(/^0+(?=\d)/, "").toLowerCase();
// "SVP085" vs "085" (promo prefix) counts as the same number; the catalog match strips it too.
const numOk = (read, truth) => { const a = normNum(read), b = normNum(truth); return !!a && (a === b || a.endsWith(b) || b.endsWith(a)); };
const nameOk = (t, g) => { const a = normName(t), b = normName(g); return !!b && (a === b || a.includes(b) || b.includes(a)); };
let spent = 0;
const tot = Object.fromEntries(widths.map((w) => [w, { n: 0, name: 0, num: 0, wrongNum: 0, noNum: 0, secondLook: 0, inTok: 0, cost: 0, ms: 0, err: 0 }]));
const out = [];
for (const r of rows) {
  const bytes = Buffer.isBuffer(r.bytes) ? r.bytes : Buffer.from(r.bytes);
  const b64 = bytes.toString("base64");
  const line = { id: String(r.id).slice(0, 8), truth: `${r.card_name} #${r.card_number} (${r.set_name})`, reads: {} };
  for (const w of widths) {
    if (spent >= cap) break;
    const t0 = Date.now();
    try {
      const content = await V.firstReadContent(b64, "image/jpeg", "en", "pokemon", false, w);
      const res = await anthropic.messages.create({
        model: MODEL, max_tokens: 2000,
        output_config: { effort: "low", format: { type: "json_schema", schema: V.POKEMON_READ_SCHEMA } },
        system: [{ type: "text", text: V.SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content }],
      });
      const u = res.usage;
      const cost = (u.input_tokens * RATE.in + u.output_tokens * RATE.out + (u.cache_read_input_tokens ?? 0) * RATE.cacheRead + (u.cache_creation_input_tokens ?? 0) * RATE.cacheWrite) / 1e6;
      spent += cost;
      const text = res.content.find((x) => x.type === "text");
      const g = text ? JSON.parse(text.text) : {};
      const okN = nameOk(r.card_name, g.name) || nameOk(r.card_name, g.englishName), okNum = numOk(g.cardNumber, r.card_number);
      const second = (typeof g.confidence === "number" && g.confidence < SECOND_LOOK_CONFIDENCE) || (!g.cardNumber && g.kind !== "art");
      const t = tot[w]; t.n++; if (okN) t.name++; if (okNum) t.num++; else if (g.cardNumber) t.wrongNum++; else t.noNum++; if (second) t.secondLook++;
      t.inTok += u.input_tokens; t.cost += cost; t.ms += Date.now() - t0;
      line.reads[w] = { name: g.name, num: g.cardNumber, total: g.setTotal, code: g.setCode, conf: g.confidence, okN, okNum, second, inTok: u.input_tokens, cost: +cost.toFixed(4), ms: Date.now() - t0 };
    } catch (e) { tot[w].err++; line.reads[w] = { error: String(e.message || e).slice(0, 80) }; }
  }
  console.log(`${line.truth} | ` + widths.map((w) => { const x = line.reads[w]; if (!x) return `${w}: skipped`; if (x.error) return `${w}: ERR ${x.error}`; return `${w}: ${x.okN ? "name✓" : "name✗[" + x.name + "]"} ${x.okNum ? "num✓" : "num✗[" + x.num + "]"}/${x.total ?? "-"} ${x.code ?? "-"} conf ${x.conf}${x.second ? " 2ND" : ""} ${x.inTok}tok ${x.ms}ms`; }).join(" | "));
  out.push(line);
  if (spent >= cap) { console.log(`spend cap $${cap} reached`); break; }
}
console.log(`\n=== ${MODEL}, ${out.length} photos, spent $${spent.toFixed(3)} ===`);
for (const w of widths) { const t = tot[w]; console.log(`strip ${String(w).padEnd(4)} n=${t.n} name ${t.name}/${t.n} number ${t.num}/${t.n} (wrong ${t.wrongNum}, none ${t.noNum}) would-second-look ${t.secondLook}/${t.n} | avg input ${t.n ? Math.round(t.inTok / t.n) : 0} tok | $${t.n ? (t.cost / t.n).toFixed(4) : "-"}/read | ${t.n ? Math.round(t.ms / t.n) : 0} ms | err ${t.err}`); }
fs.writeFileSync(`data/firstread-strip-owner-2026-10-30.json`, JSON.stringify({ model: MODEL, spent, totals: tot, lines: out }, null, 1));
