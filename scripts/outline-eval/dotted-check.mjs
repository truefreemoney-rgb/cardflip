// Are the distractor corners on dotted seams? For every coarse candidate the
// two edge lines the template assumed are sampled at a finer scale ALONG the
// line (from 1.15 to 4 radii out of the corner): a weld seam is a row of dots
// (high spread along the line, periodic), a card's edge is smooth along its
// length. Prints the along-line spread, the periodicity and the across step
// for true corners (within 4 % of the label) and distractors, and how well a
// threshold on each separates them. Run from the repo root:
//   node --experimental-strip-types scripts/outline-eval/dotted-check.mjs [filter]
// env: FINE (frame px per fine px, 2), KEEP (6), PATCH (110), SPAN (0.5), QUIET=1.
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
const KEEP = +(process.env.KEEP ?? 6);
const files = (await readdir(DUMPS)).filter((f) => f.endsWith(".json") && f.includes(filter) && labels[f.slice(11, 23)]).sort();
const NAMES = ["TL", "TR", "BR", "BL"];
const DIRS = [[[1, 0], [0, 1]], [[-1, 0], [0, 1]], [[-1, 0], [0, -1]], [[1, 0], [0, -1]]];

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
// Box blur 3x3 on a Uint8Array (same as photoQuality's blur3, which is not exported).
function blur3(g, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; s += g[yy * w + xx]; n++; } }
    out[y * w + x] = s / n;
  }
  return out;
}
const std = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length); };
const detrend = (a) => { const n = a.length, mx = (n - 1) / 2; let sxy = 0, sxx = 0, my = a.reduce((s, v) => s + v, 0) / n; for (let i = 0; i < n; i++) { sxy += (i - mx) * (a[i] - my); sxx += (i - mx) * (i - mx); } const b = sxx ? sxy / sxx : 0; return a.map((v, i) => v - my - b * (i - mx)); };
const autocorr = (a, lag) => { const n = a.length - lag; if (n < 8) return 0; let s = 0, p = 0, q = 0; for (let i = 0; i < n; i++) { s += a[i] * a[i + lag]; p += a[i] * a[i]; q += a[i + lag] * a[i + lag]; } return p && q ? s / Math.sqrt(p * q) : 0; };
const med = (a) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

// The features of one candidate corner: along-line spread, periodicity (max autocorrelation at dot-sized lags) and the across step, averaged over its two edges.
async function featuresOf(img, FW, FH, k, cx, cy, gw) {
  const r = gw * 0.045 / FINE; // card corner radius in fine px
  const reach = r * 4 + 6;
  const half = reach;
  const left = Math.max(0, Math.round(cx - half * FINE)), top = Math.max(0, Math.round(cy - half * FINE));
  const right = Math.min(FW, Math.round(cx + half * FINE)), bottom = Math.min(FH, Math.round(cy + half * FINE));
  const pw = Math.max(8, Math.round((right - left) / FINE)), ph = Math.max(8, Math.round((bottom - top) / FINE));
  const rgba = await img.clone().extract({ left, top, width: right - left, height: bottom - top }).resize(pw, ph, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  const g = blur3(pq.toGray(rgba, pw * ph), pw, ph);
  const px = (cx - left) / FINE, py = (cy - top) / FINE;
  const at = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi < 0 || yi < 0 || xi >= pw || yi >= ph ? null : g[yi * pw + xi]; };
  const [u, v] = DIRS[k];
  const res = { spread: [], period: [], step: [] };
  for (const [dir, nrm] of [[u, v], [v, u]]) {
    const along = [], steps = [];
    for (let d = r * 1.15; d <= r * 4; d += 1) {
      const x = px + dir[0] * d, y = py + dir[1] * d;
      const c = at(x, y), i = at(x + nrm[0] * 3, y + nrm[1] * 3), o = at(x - nrm[0] * 3, y - nrm[1] * 3);
      if (c === null || i === null || o === null) continue;
      along.push(c);
      steps.push(i - o);
    }
    if (along.length < 12) continue;
    const dt = detrend(along);
    res.spread.push(std(dt));
    let best = 0;
    for (let lag = Math.max(2, Math.round(2 / FINE)); lag <= Math.round(24 / FINE) + 2; lag++) best = Math.max(best, autocorr(dt, lag));
    res.period.push(best);
    res.step.push(Math.abs(steps.reduce((s, x) => s + x, 0) / steps.length));
  }
  if (!res.spread.length) return null;
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  return { spread: Math.max(...res.spread), period: Math.max(...res.period), step: mean(res.step) };
}

const trues = [], dists = [];
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
  for (let k = 0; k < 4; k++) {
    for (const [i, c] of cands[k].entries()) {
      const d = Math.hypot(((c.x - sx) / sw) * w - labC[k][0], ((c.y - sy) / sh) * h - labC[k][1]) / meta.expect.w * 100;
      const ft = await featuresOf(img, FW, FH, k, c.x, c.y, g.w);
      if (!ft) continue;
      const row = { ...ft, d, score: c.score, rank: i, frame: short, corner: NAMES[k] };
      (d <= 4 ? trues : dists).push(row);
      if (!process.env.QUIET) console.log(`${short} ${NAMES[k]} #${i} ${d <= 4 ? "TRUE" : "dist"} ${d.toFixed(0).padStart(2)}% score ${c.score.toFixed(0).padStart(3)}  spread ${ft.spread.toFixed(1).padStart(5)} period ${ft.period.toFixed(2)} step ${ft.step.toFixed(1).padStart(5)} spread/step ${(ft.spread / (ft.step + 2)).toFixed(2)}`);
    }
  }
}
console.log(`\nFINE ${FINE}: true corners ${trues.length}, distractors ${dists.length}`);
for (const [name, fn] of [["spread", (r) => r.spread], ["period", (r) => r.period], ["spread/step", (r) => r.spread / (r.step + 2)], ["step", (r) => r.step]]) {
  const t = trues.map(fn), d = dists.map(fn);
  // Threshold that keeps 90 % of the true corners (true corners are below it); how many distractors fall above it?
  const ts = [...t].sort((a, b) => a - b);
  const keep90 = ts[Math.min(ts.length - 1, Math.floor(ts.length * 0.9))];
  const vetoed = d.filter((v) => v > keep90).length;
  const ds = [...d].sort((a, b) => a - b);
  const keep90d = ds[Math.max(0, Math.floor(ds.length * 0.1))];
  const vetoedT = t.filter((v) => v < keep90d).length;
  console.log(`${name.padEnd(12)} median true ${med(t).toFixed(2)} vs dist ${med(d).toFixed(2)} | above the 90 %-of-true line (${keep90.toFixed(2)}): ${vetoed}/${d.length} distractors vetoed | below the 90 %-of-dist line (${keep90d.toFixed(2)}): ${vetoedT}/${t.length} true kept`);
}
// Which distractors are strongest (top-ranked)? Their features vs the true ones at rank 0.
const topD = dists.filter((r) => r.rank === 0);
console.log(`top-ranked distractors ${topD.length}: spread med ${med(topD.map((r) => r.spread)).toFixed(1)}, period med ${med(topD.map((r) => r.period)).toFixed(2)}, spread/step med ${med(topD.map((r) => r.spread / (r.step + 2))).toFixed(2)}`);
