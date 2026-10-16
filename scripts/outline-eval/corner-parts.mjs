// What the corner template reads at the TRUE corner (the label) versus at
// the strongest candidate in the same patch, part by part (edge, arc, far,
// inside, past), on the labeled frames. Shows which term holds the card's
// corners down on a binder page. Run from the repo root:
//   node --experimental-strip-types scripts/outline-eval/corner-parts.mjs [filter]
// env: PATCH (110), SPAN (0.5), REACH (2 patch px of play round the label), QUIET=1 (summary only).
import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const sharp = require("sharp");
const pq = await import(new URL("../../src/lib/photoQuality.ts", import.meta.url).href);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DUMPS = path.resolve(".outline-dumps");
const labels = JSON.parse(readFileSync(path.join(HERE, "labels.json"), "utf8"));
const filter = process.argv[2] ?? "";
const PATCH = +(process.env.PATCH ?? 110), SPAN = +(process.env.SPAN ?? 0.5);
const REACH = +(process.env.REACH ?? 2);
const files = (await readdir(DUMPS)).filter((f) => f.endsWith(".json") && f.includes(filter) && labels[f.slice(11, 23)]).sort();
const NAMES = ["TL", "TR", "BR", "BL"];

async function patchesFor(img, FW, FH, g) {
  const half = g.w * SPAN / 2, scale = PATCH / (g.w * SPAN);
  const out = [];
  for (const [cx, cy] of [[g.x, g.y], [g.x + g.w, g.y], [g.x + g.w, g.y + g.h], [g.x, g.y + g.h]]) {
    const left = Math.max(0, Math.round(cx - half)), top = Math.max(0, Math.round(cy - half));
    const right = Math.min(FW, Math.round(cx + half)), bottom = Math.min(FH, Math.round(cy + half));
    const pw = Math.max(8, Math.round((right - left) * scale)), ph = Math.max(8, Math.round((bottom - top) * scale));
    const rgba = await img.clone().extract({ left, top, width: right - left, height: bottom - top }).resize(pw, ph, { fit: "fill" }).ensureAlpha().raw().toBuffer();
    out.push({ gray: pq.toGray(rgba, pw * ph), pw, ph, ox: left, oy: top, scale });
  }
  return out;
}
const med = (a) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const fmt = (r) => r ? `score ${r.score.toFixed(0).padStart(4)} edge ${r.edge.toFixed(0).padStart(3)} arc ${r.arc.toFixed(0).padStart(3)} far ${r.far.toFixed(0).padStart(3)} inside ${r.inside.toFixed(0).padStart(3)} past ${r.past.toFixed(0).padStart(3)} r ${r.r.toFixed(0).padStart(2)} ${r.sign > 0 ? "+" : "-"}` : "no reading";
const parts = ["score", "edge", "arc", "far", "inside", "past"];
const trueAll = Object.fromEntries(parts.map((p) => [p, []])), distAll = Object.fromEntries(parts.map((p) => [p, []]));
let pairs = 0, trueWins = 0;
for (const f of files) {
  const stamp = f.replace(".json", "");
  const meta = JSON.parse(await readFile(path.join(DUMPS, f), "utf8"));
  if (!meta.crop) continue;
  const { sx, sy, sw, sh, w, h } = meta.crop;
  const g = meta.geometry.video;
  const img = sharp(path.join(DUMPS, `${stamp}.jpg`));
  const { width: FW, height: FH } = await img.metadata();
  const patches = await patchesFor(img, FW, FH, g);
  const cands = pq.cardCornerCandidates(patches, g.w, 6);
  const short = stamp.slice(11, 23);
  const [L, R, T, B] = labels[short];
  const labC = [[L, T], [R, T], [R, B], [L, B]];
  if (!process.env.QUIET) console.log(short);
  for (let k = 0; k < 4; k++) {
    // The label in frame px.
    const lx = sx + (labC[k][0] / w) * sw, ly = sy + (labC[k][1] / h) * sh;
    const truth = pq.cornerReadingAt(patches[k], k, g.w, lx, ly, REACH);
    const top = cands[k][0];
    const topD = top ? Math.hypot(((top.x - sx) / sw) * w - labC[k][0], ((top.y - sy) / sh) * h - labC[k][1]) / meta.expect.w * 100 : NaN;
    const dist = top && topD > 4 ? pq.cornerReadingAt(patches[k], k, g.w, top.x, top.y, 0) : null;
    if (!process.env.QUIET) console.log(`  ${NAMES[k]} true  ${fmt(truth)}` + (dist ? `\n     top   ${fmt(dist)}  (${topD.toFixed(1)} % off)` : top ? `\n     top is the true corner (${topD.toFixed(1)} % off, score ${top.score.toFixed(0)})` : "\n     no candidates"));
    if (truth && dist) {
      pairs++;
      if (truth.score > dist.score) trueWins++;
      for (const p of parts) { trueAll[p].push(truth[p]); distAll[p].push(dist[p]); }
    }
  }
}
console.log(`\n${pairs} corners where the strongest candidate is a distractor (over 4 % off); the true corner reads higher in ${trueWins}.`);
console.log("median parts   " + parts.map((p) => p.padStart(6)).join(" "));
console.log("  true corner  " + parts.map((p) => med(trueAll[p]).toFixed(1).padStart(6)).join(" "));
console.log("  distractor   " + parts.map((p) => med(distAll[p]).toFixed(1).padStart(6)).join(" "));
