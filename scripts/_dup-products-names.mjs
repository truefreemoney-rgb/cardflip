// Read-only: from $TEMP/dup-products.json (with card names), the NON-stamp doubles: which product prices the card, and
// whether a mapped product is a different card (its name does not start with the card's name). node scripts/_dup-products-names.mjs
import fs from "node:fs";
const rows = JSON.parse(fs.readFileSync(process.env.TEMP + "/dup-products.json", "utf8"));
const TAG = /\[(staff|champion|finalist|semi[- ]?finalist|quarter[- ]?finalist|top (16|32|sixteen|thirty-two))\]|\(staff\)|\[participation\]/i;
const parse = (s) => { const m = /^(\d+) (.*) \{(.*)\}$/.exec(s); if (!m) return null; const markets = {}; for (const part of m[3].split("/")) { const mm = /^(.*) \$(\d+(?:\.\d+)?)$/.exec(part.trim()); if (mm) markets[mm[1]] = Number(mm[2]); } return { pid: m[1], name: m[2], tagged: TAG.test(m[2]), markets }; };
const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim();
const SUB = { normal: "Normal", holofoil: "Holofoil", reverseHolofoil: "Reverse Holofoil", "1stEditionHolofoil": "1st Edition Holofoil", "1stEdition": "1st Edition", unlimitedHolofoil: "Unlimited Holofoil" };
const wrongCard = [], followsOther = [], kinds = {};
for (const r of rows) {
  const prods = r.pn.map(parse).filter(Boolean);
  if (prods.some((p) => p.tagged)) continue;
  const cardName = norm((r.card || "").split(" · ")[0]);
  const foreign = prods.filter((p) => cardName && !norm(p.name).startsWith(cardName.split(" ")[0]));
  const kind = prods.map((p) => (p.name.match(/\(([^)]*)\)/g) || []).join("")).join(" | ").slice(0, 60);
  kinds[kind || "(plain names)"] = (kinds[kind || "(plain names)"] ?? 0) + 1;
  if (foreign.length) wrongCard.push(`${r.cardId} ${r.card} [${r.ours}] <- ${foreign.map((p) => p.pid + " " + p.name).join("; ")}`);
  for (const part of (r.ours || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [variant, usd] = part.split(" $"); const ours = Number(usd); const sub = SUB[variant] ?? variant;
    const near = (a, b) => a != null && b != null && Math.abs(a - b) <= Math.max(0.02, a * 0.015);
    const hit = prods.find((p) => near(ours, p.markets[sub]));
    const others = prods.filter((p) => p !== hit && p.markets[sub] != null);
    if (hit && others.length && others.some((o) => Math.abs(o.markets[sub] - ours) / ours > 0.25)) followsOther.push(`${r.cardId} ${r.card} ${variant}: ours $${ours} = ${hit.name}; other ${others.map((o) => o.name + " $" + o.markets[sub]).join("; ")}`);
  }
}
console.log(`non-stamp doubles: ${rows.filter((r) => !r.pn.map(parse).some((p) => p && p.tagged)).length}`);
console.log(`\nmapped product that is a DIFFERENT card (name mismatch): ${wrongCard.length}`);
for (const l of wrongCard.slice(0, 60)) console.log("  " + l);
console.log(`\nours follows one product while another product of the same card prices >25% apart: ${followsOther.length}`);
for (const l of followsOther.slice(0, 60)) console.log("  " + l);
console.log("\nwhat the doubles look like (bracket tags in product names):");
for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${v}\t${k}`);
