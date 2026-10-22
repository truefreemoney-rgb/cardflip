// Read-only: from $TEMP/dup-products.json (scripts/_dup-products.mjs), count cards whose price follows a Staff /
// placement-stamped product instead of the plain one. node scripts/_dup-products-verdict.mjs
import fs from "node:fs";
const rows = JSON.parse(fs.readFileSync(process.env.TEMP + "/dup-products.json", "utf8"));
const TAG = /\[(staff|champion|finalist|semi[- ]?finalist|quarter[- ]?finalist|top (16|32|sixteen|thirty-two))\]|\(staff\)|\[participation\]/i;
const parse = (s) => { const m = /^(\d+) (.*) \{(.*)\}$/.exec(s); if (!m) return null; const markets = {}; for (const part of m[3].split("/")) { const mm = /^(.*) \$(\d+(?:\.\d+)?)$/.exec(part.trim()); if (mm) markets[mm[1]] = Number(mm[2]); } return { pid: m[1], name: m[2], tagged: TAG.test(m[2]), markets }; };
const SUB = { normal: "Normal", holofoil: "Holofoil", reverseHolofoil: "Reverse Holofoil", "1stEditionHolofoil": "1st Edition Holofoil", "1stEdition": "1st Edition", unlimitedHolofoil: "Unlimited Holofoil" };
let followsTag = [], plainNoPrice = [], fine = 0, unknown = 0;
for (const r of rows) {
  const prods = r.pn.map(parse).filter(Boolean);
  const plain = prods.filter((p) => !p.tagged), tagged = prods.filter((p) => p.tagged);
  if (!tagged.length) { unknown++; continue; }
  for (const part of (r.ours || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [variant, usd] = part.split(" $"); const ours = Number(usd); const sub = SUB[variant] ?? variant;
    const near = (a, b) => a != null && b != null && Math.abs(a - b) <= Math.max(0.02, a * 0.015);
    const plainM = plain.map((p) => p.markets[sub]).find((v) => v != null);
    const tagM = tagged.map((p) => p.markets[sub]).find((v) => v != null);
    if (near(ours, tagM) && !near(ours, plainM)) (plainM == null ? plainNoPrice : followsTag).push(`${r.cardId} ${variant}: ours $${ours} = stamped $${tagM}; plain ${plainM == null ? "no price" : "$" + plainM} (${tagged.map((t) => t.name).join("; ").slice(0, 80)})`);
    else fine++;
  }
}
console.log(`cards with a stamped product: ${rows.filter((r) => r.pn.map(parse).some((p) => p && p.tagged)).length}`);
console.log(`price lines following the STAMPED product while the plain one has its own price: ${followsTag.length}`);
for (const l of followsTag) console.log("  " + l);
console.log(`price lines following the stamped product because the plain one has no TCGplayer price: ${plainNoPrice.length}`);
for (const l of plainNoPrice) console.log("  " + l);
console.log(`price lines fine (plain product's price): ${fine}; cards with 2+ products but no stamp (matcher dupes, separate issue): ${unknown}`);
