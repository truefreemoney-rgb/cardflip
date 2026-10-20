// B1 scratch: run the LIVE Pokémon read (vision.ts SYSTEM + POKEMON_READ_SCHEMA, Sonnet 5, low effort)
// on Chris's own photos from the last N hours (owner only) and/or --file <jpg> paths; print the pattern read.
// Reads prod, writes nothing. Testing key only.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import Anthropic from "@anthropic-ai/sdk";
import { devAnthropicKey } from "./lib/dev-key.mjs";
import { OWNER_ARGS, OWNER_JOIN } from "./lib/owner-photos.mjs";

const root = process.cwd();
const cfg = JSON.parse(fs.readFileSync(path.join(root, ".env.migration.json"), "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const anthropic = new Anthropic({ apiKey: devAnthropicKey() });
const { POKEMON_READ_SCHEMA, SYSTEM, VISION_MODEL } = await import("../src/lib/server/vision.ts");

const args = process.argv.slice(2);
const hoursArg = args.indexOf("--hours");
const hours = hoursArg > -1 ? Number(args[hoursArg + 1]) : 0;
const files = [];
for (let i = 0; i < args.length; i++) if (args[i] === "--file") files.push(args[i + 1]);

async function readCard(b64, mediaType = "image/jpeg") {
  const t0 = Date.now();
  const response = await anthropic.messages.create({
    model: VISION_MODEL,
    max_tokens: 2000,
    output_config: { effort: "low", format: { type: "json_schema", schema: POKEMON_READ_SCHEMA } },
    system: [{ type: "text", text: SYSTEM }],
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
      { type: "text", text: "Identify this card. The seller believes it is English, but trust the photo over that if they disagree." },
    ] }],
  });
  const text = response.content.find((b) => b.type === "text");
  return { read: text ? JSON.parse(text.text) : null, ms: Date.now() - t0, usage: response.usage };
}

const jobs = [];
if (hours) {
  const since = Date.now() - hours * 3600 * 1000;
  const rows = (await db.execute({
    sql: `SELECT p.card_id AS id, p.bytes AS bytes, c.card_name, c.set_name, c.card_number, c.variant, c.created_at FROM card_photos p JOIN cards c ON c.id = p.card_id ${OWNER_JOIN} AND c.created_at > ? ORDER BY c.created_at`,
    args: [...OWNER_ARGS, since],
  })).rows;
  for (const r of rows) {
    const bytes = Buffer.isBuffer(r.bytes) ? r.bytes : Buffer.from(r.bytes);
    jobs.push({ label: `${new Date(Number(r.created_at)).toLocaleTimeString("en-US", { timeZone: "America/New_York" })} ${r.card_name} ${r.set_name} ${r.card_number} saved variant=${r.variant}`, b64: bytes.toString("base64"), mediaType: "image/jpeg" });
  }
  console.log(`${rows.length} owner photos in the last ${hours} h`);
}
for (const f of files) {
  const ext = path.extname(f).toLowerCase();
  const mediaType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  jobs.push({ label: path.basename(f), b64: fs.readFileSync(f).toString("base64"), mediaType });
}

let cost = 0;
for (const j of jobs) {
  try {
    const { read, ms, usage } = await readCard(j.b64, j.mediaType);
    cost += (usage.input_tokens * 2 + usage.output_tokens * 10) / 1e6;
    console.log(`\n## ${j.label}`);
    console.log(`read: ${read?.name} #${read?.cardNumber}/${read?.setTotal} ${read?.setCode} art=${read?.artStyle} conf=${read?.confidence} ${ms} ms`);
    console.log(`PATTERN: foilPattern=${read?.foilPattern} patternBall=${read?.patternBall}`);
  } catch (e) {
    console.log(`\n## ${j.label}\nERROR ${e?.message ?? e}`);
  }
}
console.log(`\ncost ~$${cost.toFixed(3)}`);
