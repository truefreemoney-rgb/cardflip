// One-off (09-29): does a scan under the wrong game switch re-read as the right game?
import { readFileSync } from "node:fs";
import { devAnthropicKey } from "./lib/dev-key.mjs";

process.env.ANTHROPIC_API_KEY = devAnthropicKey();
const { analyzeCardImageWithUsage } = await import(new URL("../src/lib/server/vision.ts", import.meta.url).href);

async function b64(url) {
  const res = await fetch(url, { headers: { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)", Accept: "image/*" } });
  return { data: Buffer.from(await res.arrayBuffer()).toString("base64"), type: res.headers.get("content-type").split(";")[0] };
}
const mtg = JSON.parse(readFileSync("scripts/mtg-panel.json", "utf8")).find((p) => p.bucket.startsWith("modern"))
  ?? JSON.parse(readFileSync("scripts/mtg-panel.json", "utf8"))[0];
const poke = JSON.parse(readFileSync("scripts/pokemon-panel.json", "utf8")).find((p) => p.bucket.startsWith("SV"));
for (const [label, url, game] of [["magic card, switch on pokemon", mtg.image, "pokemon"], ["pokemon card, switch on pokemon", poke.image.replace("/low.webp", "/high.webp"), "pokemon"]]) {
  const img = await b64(url);
  console.log(label, url, img.type, img.data.length);
  const r = await analyzeCardImageWithUsage(img.data, img.type, "en", game, false, () => true);
  console.log(`${label}: detected=${r.read.detectedGame} game=${r.read.game} switchedFrom=${r.read.switchedFrom ?? "-"} name=${r.read.name} code=${r.read.setCode} num=${r.read.cardNumber}`);
}
