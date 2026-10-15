// Runs findCardCorners on the recorded phone frames the way the sampler will:
// four patches round the guide's corners, each the guide's width * 0.44 wide,
// scaled to PATCH px. Prints each corner's score and, for labeled frames, the
// IoU of the box made of the four corners (crop pixels, like eval.mjs).
// Run from the repo root: node --experimental-strip-types scripts/outline-eval/corners-find.mjs [filter]
import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const sharp = require("sharp");
const pq = await import(new URL("../../src/lib/photoQuality.ts", import.meta.url).href);
const here = path.dirname(fileURLToPath(import.meta.url));
const DUMPS = path.resolve(".outline-dumps");
const labels = JSON.parse(readFileSync(path.join(here, "labels.json"), "utf8"));
const filter = process.argv[2] ?? "";
const PATCH = +(process.env.PATCH ?? 124);
const SPAN = +(process.env.SPAN ?? 0.5);
const files = (await readdir(DUMPS)).filter((f) => f.endsWith(".json") && f.includes(filter)).sort();
let labeled = 0, correct = 0, iouSum = 0, n = 0, msSum = 0, rawCorrect = 0, rawIouSum = 0, refinedCount = 0;
for (const f of files) {
  const stamp = f.replace(".json", "");
  const meta = JSON.parse(await readFile(path.join(DUMPS, f), "utf8"));
  if (!meta.crop) continue;
  const { sx, sy, sw, sh, w, h } = meta.crop;
  const g = meta.geometry.video;
  const img = sharp(path.join(DUMPS, `${stamp}.jpg`));
  const { width: FW, height: FH } = await img.metadata();
  const corners = [[g.x, g.y], [g.x + g.w, g.y], [g.x + g.w, g.y + g.h], [g.x, g.y + g.h]];
  const patches = [];
  for (const [cx, cy] of corners) {
    const half = g.w * SPAN / 2;
    const left = Math.max(0, Math.round(cx - half)), top = Math.max(0, Math.round(cy - half));
    const right = Math.min(FW, Math.round(cx + half)), bottom = Math.min(FH, Math.round(cy + half));
    const rw = right - left, rh = bottom - top;
    const scale = PATCH / (g.w * SPAN);
    const pw = Math.max(8, Math.round(rw * scale)), ph = Math.max(8, Math.round(rh * scale));
    const rgba = await img.clone().extract({ left, top, width: rw, height: rh }).resize(pw, ph, { fit: "fill" }).ensureAlpha().raw().toBuffer();
    patches.push({ gray: pq.toGray(rgba, pw * ph), pw, ph, ox: left, oy: top, scale });
  }
  const t0 = performance.now();
  const cands = pq.cardCornerCandidates(patches, g.w, +(process.env.KEEP ?? 6));
  const pick = pq.pickCardCorners(cands, +(process.env.MIN ?? 20), FW, FH);
  const fixes = pick ? pick.fixes : cands.map((c) => c[0] ?? { x: 0, y: 0, score: -Infinity, r: 0 });
  // REFINE=1: also run the line finder round the corner box on the 224-wide working crop (measured worse on 10-15; off by default).
  let refined = null;
  if (pick && process.env.REFINE) {
    const rgba224 = await img.clone().extract({ left: Math.round(sx), top: Math.round(sy), width: Math.round(sw), height: Math.round(sh) }).resize(w, h, { fit: "fill" }).ensureAlpha().raw().toBuffer();
    const gray224 = pq.toGray(rgba224, w * h);
    const cc = pick.quad.corners.map((c) => ({ x: ((c.x - sx) / sw) * w, y: ((c.y - sy) / sh) * h }));
    const ex = Math.min(cc[0].x, cc[3].x), ey = Math.min(cc[0].y, cc[1].y);
    const expectBox = { x: ex, y: ey, w: Math.max(cc[1].x, cc[2].x) - ex, h: Math.max(cc[2].y, cc[3].y) - ey };
    const grow = (sw / g.w) * (sh / g.h);
    refined = pq.findCardQuadNear(gray224, w, h, expectBox, 0.3 / grow, undefined, cc);
  }
  const ms = performance.now() - t0;
  msSum += ms; n++;
  // Frame pixels -> crop pixels.
  const cropRaw = (pick ? pick.quad.corners : fixes).map((c) => ({ x: ((c.x - sx) / sw) * w, y: ((c.y - sy) / sh) * h }));
  const crop = refined ? refined.corners : cropRaw;
  const short = stamp.slice(11, 23);
  const lab = labels[short];
  let note = "";
  if (lab) {
    labeled++;
    const [L, R, T, B] = lab;
    const xs = crop.map((p) => p.x), ys = crop.map((p) => p.y);
    const l = Math.min(...xs), r = Math.max(...xs), t = Math.min(...ys), b = Math.max(...ys);
    const ix = Math.max(0, Math.min(r, R) - Math.max(l, L)), iy = Math.max(0, Math.min(b, B) - Math.max(t, T));
    const inter = ix * iy;
    const iou = inter / ((r - l) * (b - t) + (R - L) * (B - T) - inter);
    iouSum += iou;
    if (iou >= 0.9) correct++;
    const rxs = cropRaw.map((p) => p.x), rys = cropRaw.map((p) => p.y);
    const rl = Math.min(...rxs), rr = Math.max(...rxs), rt = Math.min(...rys), rb = Math.max(...rys);
    const rix = Math.max(0, Math.min(rr, R) - Math.max(rl, L)), riy = Math.max(0, Math.min(rb, B) - Math.max(rt, T));
    const rinter = rix * riy;
    const rawIou = rinter / ((rr - rl) * (rb - rt) + (R - L) * (B - T) - rinter);
    rawIouSum += rawIou;
    if (rawIou >= 0.9) rawCorrect++;
    if (refined) refinedCount++;
    note = `  IoU ${iou.toFixed(2)}${iou >= 0.9 ? " OK" : " WRONG"} (corners ${rawIou.toFixed(2)}${refined ? ", refined" : ", no lines"})  label L${L} R${R} T${T} B${B}`;
  }
  console.log(`${short}  ${ms.toFixed(0).padStart(4)}ms ${pick ? (pick.fixes.some((f) => f.score === -Infinity) ? "3of4" : "4of4") : "none"} ` + fixes.map((c, i) => `${"TL TR BR BL".split(" ")[i]}(${crop[i].x.toFixed(0)},${crop[i].y.toFixed(0)}) s${c.score.toFixed(1)} r${(c.r / (sw / w)).toFixed(1)}`).join("  ") + note);
}
console.log(`frames ${n}, mean ${(msSum / Math.max(1, n)).toFixed(1)} ms` + (labeled ? `  labeled ${labeled}: correct ${correct}, mean IoU ${(iouSum / labeled).toFixed(3)} (corners alone: ${rawCorrect}, ${(rawIouSum / labeled).toFixed(3)}; refined ${refinedCount})` : ""));
