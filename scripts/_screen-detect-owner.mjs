// Screen-shot test (10-30): can the FIRST read tell a photo of a card on a screen (TCG Pocket, a listing photo) from a
// real card? 14-day log: one account's 134 of 144 scans had no number at 30-50% confidence, the signature of Chris's
// own Sylveon shots taken off a screen; every real-card user read the number fine. Owner photos only, TESTING key,
// writes nothing. Truth: Chris's Sylveon rows = screen, everything else = card.
//   node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_screen-detect-owner.mjs [--real 12] [--cap 0.30]
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@libsql/client";
import { devAnthropicKey } from "./lib/dev-key.mjs";
import { OWNER_ARGS, OWNER_JOIN } from "./lib/owner-photos.mjs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const realN = Number(arg("--real", 12)), cap = Number(arg("--cap", 0.3));
const MODEL = "claude-sonnet-5", RATE = { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 };
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const anthropic = new Anthropic({ apiKey: devAnthropicKey() });
const V = await import("../src/lib/server/vision.ts");
const SCHEMA = {
  ...V.POKEMON_READ_SCHEMA,
  properties: {
    ...V.POKEMON_READ_SCHEMA.properties,
    photoOf: {
      type: "string",
      enum: ["card", "screen", "print", "unknown"],
      description:
        "What the camera photographed. 'card': a physical card (paper stock, a sleeve, a toploader, a table or hand behind it). 'screen': a card shown on a phone, tablet, monitor or TV — look for pixel grid or moiré, a glowing backlit look, a screen bezel or browser/app chrome, interface text or buttons around the card, a digital-only card design (Pokémon TCG Pocket cards say 'your opponent gets 2 points' and print no collector number). 'print': a card printed on paper or in a magazine (a flat printed page, halftone dots). 'unknown' when you cannot tell.",
    },
  },
  required: [...V.POKEMON_READ_SCHEMA.required, "photoOf"],
};
const rows = (await db.execute({ sql: `SELECT p.card_id id, p.bytes, c.card_name, c.card_number, c.set_name FROM card_photos p JOIN cards c ON c.id = p.card_id ${OWNER_JOIN} WHERE c.game='pokemon' ORDER BY c.created_at DESC`, args: OWNER_ARGS })).rows;
const screen = rows.filter((r) => /^Sylveon/.test(String(r.card_name)));
const real = rows.filter((r) => !/^Sylveon/.test(String(r.card_name))).slice(0, realN);
let spent = 0; const tot = { screen: { n: 0, right: 0, says: {} }, card: { n: 0, right: 0, says: {} } };
for (const [truth, list] of [["screen", screen], ["card", real]]) {
  for (const r of list) {
    if (spent >= cap) break;
    const bytes = Buffer.isBuffer(r.bytes) ? r.bytes : Buffer.from(r.bytes);
    const content = await V.firstReadContent(bytes.toString("base64"), "image/jpeg", "en", "pokemon", false, 0);
    const res = await anthropic.messages.create({
      model: MODEL, max_tokens: 2000,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: V.SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    });
    const u = res.usage;
    spent += (u.input_tokens * RATE.in + u.output_tokens * RATE.out + (u.cache_read_input_tokens ?? 0) * RATE.cacheRead + (u.cache_creation_input_tokens ?? 0) * RATE.cacheWrite) / 1e6;
    const text = res.content.find((x) => x.type === "text");
    const g = text ? JSON.parse(text.text) : {};
    const t = tot[truth]; t.n++; if (g.photoOf === truth) t.right++; t.says[g.photoOf ?? "-"] = (t.says[g.photoOf ?? "-"] ?? 0) + 1;
    console.log(`${truth.padEnd(6)} ${r.card_name} #${r.card_number} (${r.set_name}) -> photoOf ${g.photoOf} | num ${g.cardNumber ?? "-"} conf ${g.confidence}`);
  }
}
console.log(`\n=== spent $${spent.toFixed(3)} ===`);
for (const k of ["screen", "card"]) console.log(k, `${tot[k].right}/${tot[k].n} right`, JSON.stringify(tot[k].says));
