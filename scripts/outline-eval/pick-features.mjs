// What separates the right box from the one pickCardCorners picks: for each
// labeled frame, every scored box's features (scoreCardBoxes), the best-IoU
// box ("true") with its rank, and the top boxes by score. Run from the repo
// root: node --experimental-strip-types scripts/outline-eval/pick-features.mjs [filter]
// env: KEEP (6), MIN (20), TUNE (JSON), TOP (3 boxes shown per frame).
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
const PATCH = 110, SPAN = 0.5;
const MIN = +(process.env.MIN ?? 20);
const KEEP = +(process.env.KEEP ?? 6);
const TOP = +(process.env.TOP ?? 3);
const TUNE = process.env.TUNE ? JSON.parse(process.env.TUNE) : {};
const files = (await readdir(DUMPS)).filter((f) => f.endsWith(".json") && f.includes(filter) && labels[f.slice(11, 23)]).sort();

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
const iouBox = ([l, r, t, b], [L, R, T, B]) => {
  const ix = Math.max(0, Math.min(r, R) - Math.max(l, L)), iy = Math.max(0, Math.min(b, B) - Math.max(t, T));
  const inter = ix * iy;
  return inter / ((r - l) * (b - t) + (R - L) * (B - T) - inter);
};
const fmt = (s, iou, rank, n) => `  ${rank === 0 ? "PICK" : `#${rank}`.padStart(4)}/${n} IoU ${iou.toFixed(2)} score ${s.score.toFixed(0).padStart(4)} corners ${s.fixes.map((f) => (f.score === -Infinity ? "  -" : Math.min(f.score, 999).toFixed(0).padStart(3))).join("/")} sum ${s.cornerSum.toFixed(0).padStart(3)} sup ${s.support.toFixed(2)} sides ${s.sides.map((v) => v.toFixed(2)).join("/")} asp ${(s.aspectErr * 100).toFixed(0).padStart(2)}% even ${(s.evenErr * 100).toFixed(0).padStart(2)}% par ${s.parErr.toFixed(1)}° odd ${s.odd} r ${s.fixes.map((f) => (f.score === -Infinity ? "-" : f.r.toFixed(0))).join("/")} sign ${s.fixes.map((f) => (f.sign > 0 ? "+" : f.sign < 0 ? "-" : "0")).join("")}`;

let trueRankSum = 0, frames = 0, trueTop = 0;
for (const f of files) {
  const stamp = f.replace(".json", "");
  const meta = JSON.parse(await readFile(path.join(DUMPS, f), "utf8"));
  if (!meta.crop) continue;
  const { sx, sy, sw, sh, w, h } = meta.crop;
  const g = meta.geometry.video;
  const img = sharp(path.join(DUMPS, `${stamp}.jpg`));
  const { width: FW, height: FH } = await img.metadata();
  const rgba = await img.clone().extract({ left: Math.round(sx), top: Math.round(sy), width: Math.round(sw), height: Math.round(sh) }).resize(w, h, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  const support = { gray: pq.toGray(rgba, w * h), w, h, sx, sy, sw, sh };
  const cands = pq.cardCornerCandidates(await patchesFor(img, FW, FH, g), g.w, KEEP);
  const scored = pq.scoreCardBoxes(cands, MIN, FW, FH, { support, tune: TUNE });
  const short = stamp.slice(11, 23);
  // The label is in crop px; boxes are in frame px.
  const [L, R, T, B] = labels[short];
  const labFrame = [sx + (L / w) * sw, sx + (R / w) * sw, sy + (T / h) * sh, sy + (B / h) * sh];
  const withIou = scored.map((s, i) => ({ s, i, iou: iouBox(s.box, labFrame) }));
  const best = withIou.reduce((a, b) => (b.iou > a.iou ? b : a), { iou: -1, i: -1, s: null });
  frames++;
  if (best.i >= 0) { trueRankSum += best.i; if (best.i === 0) trueTop++; }
  console.log(`${short}  boxes ${scored.length}  best possible IoU ${best.iou.toFixed(2)} at rank ${best.i}`);
  for (let k = 0; k < Math.min(TOP, withIou.length); k++) console.log(fmt(withIou[k].s, withIou[k].iou, k, scored.length));
  if (best.i >= TOP) console.log(fmt(best.s, best.iou, best.i, scored.length) + "  <== best IoU");
}
console.log(`frames ${frames}: the best-IoU box is the pick in ${trueTop}, mean rank ${(trueRankSum / Math.max(1, frames)).toFixed(1)}`);
