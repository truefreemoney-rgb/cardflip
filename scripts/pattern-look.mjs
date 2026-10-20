// B1 scratch: a focused "pattern look" on a crop of the text box (art bottom to the weakness line), enlarged,
// asked ONLY about the foil symbol. Compares effort low vs medium. --file paths. Testing key, writes nothing.
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { devAnthropicKey } from "./lib/dev-key.mjs";
const sharp = (await import("sharp")).default;
const anthropic = new Anthropic({ apiKey: devAnthropicKey() });
const MODEL = "claude-sonnet-5";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    foilPattern: { type: "string", enum: ["none", "reverse", "ball", "energySymbol", "teamRocket", "unknown"], description: "What the foil behind the ability / attack text shows. 'ball': a circle cut in half by a horizontal band with a small round button at the centre, either one large pale ball as wide as the text box (its outline runs from the ability line to the attack line, the band and button sit under the attack name; on cracked-glass foil it is faint, so trace the outline through the text), or rows of many medium balls. 'reverse': foil but no symbol anywhere. 'none': no foil here. 'energySymbol': one large energy icon, no band. 'teamRocket': a large letter R. 'unknown': glare hides the area." },
    patternBall: { type: "string", enum: ["poke", "master", "friend", "love", "quick", "dusk", "unknown"], description: "Only when foilPattern is 'ball'. Judge by shape, the foil tints everything one colour. 'poke': the top half of the ball is empty. 'master': the top half carries a large M (two tall bumps joined by a V, like a crown). 'unknown': a ball you cannot place." },
    where: { type: "string", description: "One short sentence: where in the crop the symbol's band and button are, or what you see instead." },
  },
  required: ["foilPattern", "patternBall", "where"],
};
const SYSTEM = "You are inspecting a crop of the lower half of a Pokémon trading card: the ability / attack text box and the lines under it. Reverse holo cards from some sets print a symbol in the foil behind that text, and each symbol is a separate product, so this one detail matters. Look at the foil pattern itself, not the text or the energy icons printed on top of it. Answer with the schema only.";

async function crop(file) {
  const input = fs.readFileSync(file);
  const meta = await sharp(input).metadata();
  const w = meta.width, h = meta.height;
  const top = Math.round(h * 0.42), bottom = Math.round(h * 0.88);
  const out = await sharp(input).extract({ left: 0, top, width: w, height: bottom - top }).resize({ width: Math.min(1568, Math.max(w, 1400)), withoutEnlargement: false }).jpeg({ quality: 90 }).toBuffer();
  return out.toString("base64");
}
async function look(b64, effort) {
  const t0 = Date.now();
  const r = await anthropic.messages.create({
    model: MODEL, max_tokens: 400,
    output_config: { effort, format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }, { type: "text", text: "What symbol, if any, is in the foil behind the attack text?" }] }],
  });
  const text = r.content.find((b) => b.type === "text");
  return { read: JSON.parse(text.text), ms: Date.now() - t0, cost: (r.usage.input_tokens * 2 + r.usage.output_tokens * 10) / 1e6 };
}
const files = [];
const a = process.argv.slice(2);
for (let i = 0; i < a.length; i++) if (a[i] === "--file") files.push(a[i + 1]);
let cost = 0;
for (const f of files) {
  const b64 = await crop(f);
  const [lo, md] = await Promise.all([look(b64, "low"), look(b64, "medium")]);
  cost += lo.cost + md.cost;
  console.log(`## ${path.basename(f)}`);
  console.log(`   low:    ${lo.read.foilPattern}/${lo.read.patternBall} ${lo.ms} ms  (${lo.read.where})`);
  console.log(`   medium: ${md.read.foilPattern}/${md.read.patternBall} ${md.ms} ms  (${md.read.where})`);
}
console.log(`cost ~$${cost.toFixed(3)}`);
