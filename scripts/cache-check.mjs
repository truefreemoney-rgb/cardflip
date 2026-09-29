// One-off: does the vision system-prompt cache hit for a game? Two reads of
// one card on the Testing key; read 2 should show cacheReadTokens > 0.
//   node --experimental-strip-types scripts/cache-check.mjs pokemon
import { readFileSync } from "node:fs";
import { devAnthropicKey } from "./lib/dev-key.mjs";

const game = process.argv[2] ?? "pokemon";
process.env.ANTHROPIC_API_KEY = devAnthropicKey();
const { analyzeCardImageWithUsage } = await import(new URL("../src/lib/server/vision.ts", import.meta.url).href);

const row = JSON.parse(readFileSync("scripts/pokemon-panel.json", "utf8")).find((p) => p.set === "sv01" || p.image.includes("/high") || p.image.includes("/low.webp"));
const url = row.image.replace("/low.webp", "/high.webp");
const res = await fetch(url);
const mediaType = res.headers.get("content-type").split(";")[0];
const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
console.log(`card ${row.id} ${mediaType}`);
for (const i of [1, 2]) {
  const t = Date.now();
  const r = await analyzeCardImageWithUsage(b64, mediaType, "en", game);
  console.log(`read ${i}: ${Date.now() - t} ms`, JSON.stringify(r.usage), r.read?.name);
}
