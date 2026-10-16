// Coarse-to-fine check: the coarse candidates (PATCH 110, as the phone finds
// them) are each re-read by the same corner template at a finer scale in a
// small window round the candidate. Does the true corner then outscore the
// distractors in its patch? Prints, per corner, the true corner's rank
// before and after, and the refined position's error. Run from the repo root:
//   node --experimental-strip-types scripts/outline-eval/refine-check.mjs [filter]
// env: FINE (frame px per fine px: 1 = full res, 2 = half res; default 2),
// REACH (search radius round the candidate, in % of the guide width; 1.5),
// KEEP (6), QUIET=1 (summary only), PATCH (110), SPAN (0.5).
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
const FINE = +(process.env.FINE ?? 2);
const REACH = +(process.env.REACH ?? 1.5);
const KEEP = +(process.env.KEEP ?? 6);
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
// A fine patch round (x, y): wide enough for the search reach plus the template's margin at the biggest radius.
async function finePatch(img, FW, FH, x, y, reachPx, gw) {
  const r = gw * 0.045 * 1.25 / FINE; // biggest radius in fine px
  const marginPx = (Math.ceil(r) + 4) * FINE;
  const half = reachPx + marginPx;
  const left = Math.max(0, Math.round(x - half)), top = Math.max(0, Math.round(y - half));
  const right = Math.min(FW, Math.round(x + half)), bottom = Math.min(FH, Math.round(y + half));
  const pw = Math.max(8, Math.round((right - left) / FINE)), ph = Math.max(8, Math.round((bottom - top) / FINE));
  const rgba = await img.clone().extract({ left, top, width: right - left, height: bottom - top }).resize(pw, ph, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  return { gray: pq.toGray(rgba, pw * ph), pw, ph, ox: left, oy: top, scale: 1 / FINE };
}
const med = (a) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
let corners = 0, hadTrue = 0, coarseTop = 0, fineTop = 0, fineTop2 = 0;
const coarseErr = [], fineErr = [], fineRanks = [];
let msSum = 0, windows = 0;
for (const f of files) {
  const stamp = f.replace(".json", "");
  const meta = JSON.parse(await readFile(path.join(DUMPS, f), "utf8"));
  if (!meta.crop) continue;
  const { sx, sy, sw, sh, w, h } = meta.crop;
  const g = meta.geometry.video;
  const img = sharp(path.join(DUMPS, `${stamp}.jpg`));
  const { width: FW, height: FH } = await img.metadata();
  const cands = pq.cardCornerCandidates(await patchesFor(img, FW, FH, g), g.w, KEEP);
  const short = stamp.slice(11, 23);
  const [L, R, T, B] = labels[short];
  const labC = [[L, T], [R, T], [R, B], [L, B]];
  const toCropD = (x, y, k) => Math.hypot(((x - sx) / sw) * w - labC[k][0], ((y - sy) / sh) * h - labC[k][1]) / meta.expect.w * 100;
  const lines = [];
  for (let k = 0; k < 4; k++) {
    const list = cands[k];
    if (!list.length) { lines.push(`  ${NAMES[k]} no candidates`); continue; }
    corners++;
    const coarse = list.map((c, i) => ({ i, c, d: toCropD(c.x, c.y, k) }));
    const trueIdx = coarse.reduce((best, x) => (x.d < best.d ? x : best), { d: Infinity, i: -1 }).i;
    const truePresent = trueIdx >= 0 && coarse[trueIdx].d <= 4;
    if (truePresent) { hadTrue++; if (trueIdx === 0) coarseTop++; coarseErr.push(coarse[trueIdx].d); }
    // Refine each candidate.
    const reachPx = g.w * REACH / 100;
    const refined = [];
    for (const x of coarse) {
      const patch = await finePatch(img, FW, FH, x.c.x, x.c.y, reachPx, g.w);
      const t0 = performance.now();
      const reading = pq.cornerReadingAt(patch, k, g.w, x.c.x, x.c.y, Math.round(reachPx / FINE), true);
      msSum += performance.now() - t0; windows++;
      refined.push({ ...x, reading });
    }
    const order = [...refined].sort((a, b) => (b.reading?.score ?? -Infinity) - (a.reading?.score ?? -Infinity));
    const trueRank = truePresent ? order.findIndex((x) => x.i === trueIdx) : -1;
    if (truePresent) {
      fineRanks.push(trueRank);
      if (trueRank === 0) fineTop++;
      if (trueRank <= 1) fineTop2++;
      const r = refined[trueIdx].reading;
      if (r) fineErr.push(toCropD(r.x, r.y, k));
    }
    lines.push(`  ${NAMES[k]} ${truePresent ? `true #${trueIdx} -> fine #${trueRank}` : "true corner not among candidates"}  ` + order.map((x) => `${x.i === trueIdx && truePresent ? "*" : ""}${x.d.toFixed(0)}%:${x.c.score.toFixed(0)}->${x.reading ? x.reading.score.toFixed(0) : "-"}`).join(" "));
  }
  if (!process.env.QUIET) console.log(short + "\n" + lines.join("\n"));
}
console.log(`\nFINE ${FINE} REACH ${REACH}% KEEP ${KEEP}: ${corners} corners, true corner among the candidates in ${hadTrue}; it is the strongest coarse candidate in ${coarseTop}, the strongest refined in ${fineTop} (top two: ${fineTop2}); refined rank med ${med(fineRanks)}; position error med % coarse ${med(coarseErr).toFixed(1)} -> refined ${med(fineErr).toFixed(1)}; ${(msSum / Math.max(1, windows)).toFixed(2)} ms per window (${windows} windows)`);
