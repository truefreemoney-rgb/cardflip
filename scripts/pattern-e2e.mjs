// Scratch: the real pipeline (analyzeCardImageWithUsage incl. the pattern look) on --file images, testing key only.
import fs from "node:fs";
import path from "node:path";
import { devAnthropicKey } from "./lib/dev-key.mjs";
process.env.ANTHROPIC_API_KEY = devAnthropicKey();
const { analyzeCardImageWithUsage } = await import("../src/lib/server/vision.ts");
const files = [];
const a = process.argv.slice(2);
for (let i = 0; i < a.length; i++) if (a[i] === "--file") files.push(a[i + 1]);
for (const f of files) {
  const t0 = Date.now();
  const b64 = fs.readFileSync(f).toString("base64");
  const mt = f.endsWith(".png") ? "image/png" : f.endsWith(".webp") ? "image/webp" : "image/jpeg";
  try {
    const { read, usage } = await analyzeCardImageWithUsage(b64, mt, "en", "pokemon", false, undefined, t0);
    console.log(`${path.basename(f)}: ${read.name} ${read.setCode} #${read.cardNumber} pattern=${read.foilPattern}/${read.patternBall} look=${read.patternLook ?? "-"} ${Date.now() - t0} ms in=${usage.inputTokens} out=${usage.outputTokens}`);
  } catch (e) {
    console.log(`${path.basename(f)}: ERROR ${e?.message ?? e}`);
  }
}
