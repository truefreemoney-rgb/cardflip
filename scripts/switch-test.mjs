// Game auto-switch on catalog images (09-29, Chris has no cards to test it
// with): Magic cards read with the switch on Pokémon, and Pokémon cards with
// the switch on Magic, through the scanner's own analyzeCardImageWithUsage.
// Pass = the read comes back as the right game, switchedFrom set, right name.
// ~9 cards × 2 reads on the testing key (≈ $0.25).
//
//   node --experimental-strip-types --no-warnings --conditions=react-server \
//     --import ./scripts/lib/register-alias.mjs scripts/switch-test.mjs
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { devAnthropicKey } from "./lib/dev-key.mjs";

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { analyzeCardImageWithUsage } = await import(at("lib/server/vision.ts"));
process.env.ANTHROPIC_API_KEY = devAnthropicKey();

const db = new DatabaseSync(path.join(process.cwd(), "data/cardflip.db"), { readOnly: true });
const panel = JSON.parse(fs.readFileSync("scripts/mtg-panel.json", "utf8"));
const pickBucket = (b) => panel.find((p) => p.bucket === b);
const mtg = ["pre-1998", "1998-2014 number-only", "M15 standard", "borderless", "showcase", "2025+ sets"]
  .map(pickBucket)
  .filter(Boolean)
  .map((p) => ({ game: "mtg", name: p.name, image: p.image.replace("/normal/", "/large/"), under: "pokemon" }));
const pkm = db
  .prepare("SELECT name, image_url FROM en_cards WHERE image_url <> '' AND set_id IN ('base1','sv3pt5','swsh12') ORDER BY id LIMIT 3")
  .all()
  .map((r) => ({ game: "pokemon", name: r.name, image: r.image_url.replace("/low.webp", "/high.jpg"), under: "mtg" }));
const only = process.argv.includes("--pokemon") ? "pokemon" : process.argv.includes("--mtg") ? "mtg" : null;

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
let pass = 0;
const all = [...mtg, ...pkm].filter((c) => !only || c.game === only);
for (const c of all) {
  const res = await fetch(c.image, { headers: { "user-agent": "CardFlip/1.0 (support@cardflip.io)", accept: "image/*" } });
  if (!res.ok) { console.log(`skip ${c.name}: image ${res.status}`); continue; }
  const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  const { read } = await analyzeCardImageWithUsage(b64, c.type ?? "image/jpeg", "en", c.under, false, () => true);
  const nameOk = norm(read.name).includes(norm(c.name).slice(0, 12)) || norm(c.name).includes(norm(read.name));
  const ok = read.game === c.game && read.switchedFrom === c.under && nameOk;
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.game} card under the ${c.under} switch: ${c.name} → read "${read.name}" as ${read.game ?? "?"} [detectedGame=${read.detectedGame ?? "null"}]${read.switchedFrom ? ` (switched from ${read.switchedFrom})` : " (no switch)"}`);
}
console.log(`\n${pass}/${all.length} switched correctly`);
