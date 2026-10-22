// Wrong-game one-read test (Chris 10-22, "obviously scanning multiple times on the backend"): when a MAGIC card is
// photographed with the scanner on POKEMON, the first read (Pokemon prompt + schema) says "this is Magic" and the
// switch sends the SAME photo for a second read with the Magic prompt. Could the first read's generic fields
// (name, collector number, set code) carry the match on their own? Owner photos only, TESTING key, hard cap, no DB writes.
//   node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_wronggame-oneread-owner.mjs [--truth mtg] [--as pokemon] [--limit 20] [--cap 0.60]
import fs from "node:fs";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@libsql/client";
import { devAnthropicKey } from "./lib/dev-key.mjs";
import { OWNER_ARGS, OWNER_JOIN } from "./lib/owner-photos.mjs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const truth = arg("--truth", "mtg"), as = arg("--as", "pokemon");
const limit = Number(arg("--limit", 20)), cap = Number(arg("--cap", 0.6));
const MODEL = "claude-sonnet-5", RATE = { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 };
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const anthropic = new Anthropic({ apiKey: devAnthropicKey() });
const V = await import("../src/lib/server/vision.ts");
const schemaFor = (g) => g === "mtg" ? V.MTG_READ_SCHEMA : g === "lorcana" || g === "onepiece" ? V.TCG_READ_SCHEMA : g === "yugioh" ? V.YUGIOH_READ_SCHEMA : V.CARD_READ_SCHEMA;
const systemFor = (g) => g === "mtg" ? V.SYSTEM_MTG : g === "lorcana" ? V.SYSTEM_LORCANA : g === "onepiece" ? V.SYSTEM_ONEPIECE : g === "yugioh" ? V.SYSTEM_YUGIOH : V.SYSTEM;
const rows = (await db.execute({ sql: `SELECT p.card_id id, p.bytes, c.game, c.card_name, c.card_number, c.set_name FROM card_photos p JOIN cards c ON c.id = p.card_id ${OWNER_JOIN} WHERE c.game = ? ORDER BY c.created_at DESC LIMIT ?`, args: [...OWNER_ARGS, truth, limit] })).rows;
const normName = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const normNum = (s) => String(s ?? "").trim().split("/")[0].replace(/^0+(?=\d)/, "").toLowerCase();
const nameOk = (t, g) => { const a = normName(t), b = normName(g); return !!b && (a === b || a.includes(b) || b.includes(a)); };
let spent = 0, n = 0, okName = 0, okNum = 0, okBoth = 0, detected = 0, err = 0; const out = [];
for (const r of rows) {
  if (spent >= cap) { console.log(`spend cap $${cap} reached`); break; }
  const bytes = Buffer.isBuffer(r.bytes) ? r.bytes : Buffer.from(r.bytes);
  const b = await sharp(bytes).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  try {
    const res = await anthropic.messages.create({
      model: MODEL, max_tokens: 2000,
      output_config: { effort: "low", format: { type: "json_schema", schema: schemaFor(as) } },
      system: [{ type: "text", text: systemFor(as), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b.toString("base64") } },
        { type: "text", text: "Identify this card. The seller believes it is English, but trust the photo over that if they disagree." },
      ] }],
    });
    const u = res.usage;
    spent += (u.input_tokens * RATE.in + u.output_tokens * RATE.out + (u.cache_read_input_tokens ?? 0) * RATE.cacheRead + (u.cache_creation_input_tokens ?? 0) * RATE.cacheWrite) / 1e6;
    const text = res.content.find((x) => x.type === "text");
    const g = text ? JSON.parse(text.text) : {};
    const oN = nameOk(r.card_name, g.name) || nameOk(r.card_name, g.englishName), oNum = normNum(g.cardNumber) === normNum(r.card_number), det = g.cardGame;
    n++; if (oN) okName++; if (oNum) okNum++; if (oN && oNum) okBoth++; if (det === truth) detected++;
    const line = { truth: `${r.card_name} #${r.card_number} (${r.set_name})`, read: { name: g.name, num: g.cardNumber, setCode: g.setCode, setName: g.setName, cardGame: det, confidence: g.confidence }, oN, oNum };
    out.push(line);
    console.log(`${line.truth} -> game=${det} ${oN ? "name OK" : "name NO[" + g.name + "]"} ${oNum ? "num OK" : "num NO[" + g.cardNumber + "]"} set=${g.setCode ?? "-"}/${g.setName ?? "-"} conf=${g.confidence}`);
  } catch (e) { err++; console.log(`${r.card_name}: ERR ${String(e.message || e).slice(0, 100)}`); }
}
console.log(`\n=== ${truth} photos read as ${as} with ${MODEL}: n=${n} detectedGame right ${detected}/${n}, name ${okName}/${n}, number ${okNum}/${n}, both ${okBoth}/${n}, err ${err}, spent $${spent.toFixed(3)} ===`);
fs.writeFileSync(`data/wronggame-oneread-2026-10-22-${truth}-as-${as}.json`, JSON.stringify({ model: MODEL, truth, as, spent, n, okName, okNum, okBoth, detected, lines: out }, null, 1));