// Selection rules over the scored boxes (scoreCardBoxes), measured on the
// labeled frames without touching src: the boxes are scored once per frame
// (with the working crop), then each rule picks one and is marked against
// the label (IoU >= 0.9 = correct). Run from the repo root:
//   node --experimental-strip-types scripts/outline-eval/pick-rules.mjs
// env: KEEP (6), MIN (20), PATCH (110), TUNE (JSON for scoreCardBoxes).
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
const PATCH = +(process.env.PATCH ?? 110), SPAN = 0.5;
const MIN = +(process.env.MIN ?? 20);
const KEEP = +(process.env.KEEP ?? 6);
const TUNE = process.env.TUNE ? JSON.parse(process.env.TUNE) : {};
const files = (await readdir(DUMPS)).filter((f) => f.endsWith(".json") && labels[f.slice(11, 23)]).sort();

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

// Scored boxes per frame, with each box's IoU against the label.
const frames = [];
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
  const boxes = pq.scoreCardBoxes(cands, MIN, FW, FH, { support, tune: TUNE });
  const [L, R, T, B] = labels[stamp.slice(11, 23)];
  const lab = [sx + (L / w) * sw, sx + (R / w) * sw, sy + (T / h) * sh, sy + (B / h) * sh];
  const guide = [g.x, g.x + g.w, g.y, g.y + g.h];
  frames.push({ short: stamp.slice(11, 23), boxes: boxes.map((b) => ({ ...b, iou: iouBox(b.box, lab), guideIou: iouBox(b.box, guide), width: b.box[1] - b.box[0] })), gw: g.w });
}

// Scorings: the box's score as is, without the support factor, or with its square root.
const missingOf = (b) => b.fixes.filter((f) => f.score === -Infinity).length;
const penalty = (b) => b.aspectErr * 100 + b.evenErr * 100 + 2 * b.parErr;
const scorings = {
  sup: (b) => b.score,
  nosup: (b) => b.cornerSum * (missingOf(b) ? 0.85 : 1) - penalty(b),
  sqrt: (b) => b.cornerSum * Math.sqrt(b.support) * (missingOf(b) ? 0.85 : 1) - penalty(b),
  // Where the user aimed: a bonus of wGuide x the overlap with the guide, in score points (a box scores ~100-200).
  "g50": (b) => b.score + 50 * b.guideIou,
  "g100": (b) => b.score + 100 * b.guideIou,
  "g200": (b) => b.score + 200 * b.guideIou,
  "g400": (b) => b.score + 400 * b.guideIou,
  "gx1": (b) => b.score * (0.5 + b.guideIou),
  "gx2": (b) => b.score * b.guideIou,
  "nosup-g100": (b) => b.cornerSum * (missingOf(b) ? 0.85 : 1) - penalty(b) + 100 * b.guideIou,
  "nosup-g200": (b) => b.cornerSum * (missingOf(b) ? 0.85 : 1) - penalty(b) + 200 * b.guideIou,
  "nosup-gx2": (b) => (b.cornerSum * (missingOf(b) ? 0.85 : 1) - penalty(b)) * b.guideIou,
  "guideonly": (b) => b.guideIou,
};
// Nested: starting from the best, step down to a box inside the current one
// (every edge within `slack` of the width, at least `shrink` narrower) whose
// score is at least `f` of the current, taking the best such; repeat.
const inside = (inner, outer, slack, shrink) => {
  const [l, r, t, b] = outer.box, s = (r - l) * slack;
  return inner.box[0] >= l - s && inner.box[1] <= r + s && inner.box[2] >= t - s && inner.box[3] <= b + s && inner.width <= (r - l) * (1 - shrink);
};
const pickNested = (boxes, scoreOf, f, slack, shrink) => {
  if (!boxes.length) return null;
  const scored = boxes.map((b) => ({ b, s: scoreOf(b) })).sort((p, q) => q.s - p.s);
  let cur = scored[0];
  if (f > 0) for (let step = 0; step < 4; step++) {
    const inner = scored.filter((x) => x !== cur && x.s >= cur.s * f && inside(x.b, cur.b, slack, shrink));
    if (!inner.length) break;
    cur = inner[0];
  }
  return cur.b;
};
const rows = [];
const NESTED = process.env.NESTED === "1";
for (const [sname, scoreOf] of Object.entries(scorings)) {
  for (const f of NESTED ? [0, 0.3, 0.4, 0.5, 0.6, 0.7] : [0]) {
    for (const shrink of [0.02, 0.04]) {
      let correct = 0, iouSum = 0, n = 0;
      for (const fr of frames) {
        const p = pickNested(fr.boxes, scoreOf, f, 0.02, shrink);
        const iou = p ? p.iou : 0;
        n++; iouSum += iou; if (iou >= 0.9) correct++;
      }
      rows.push({ rule: `${sname.padEnd(10)}${f ? ` nested f=${f} shrink=${shrink}` : ""}`, correct, mean: iouSum / n });
      if (f === 0) break;
    }
  }
}
rows.sort((a, b) => b.correct - a.correct || b.mean - a.mean);
for (const r of rows) console.log(`${r.rule.padEnd(34)} correct ${String(r.correct).padStart(2)}/${frames.length}  mean IoU ${r.mean.toFixed(3)}`);
// The best possible box per frame, for reference.
const ceil = frames.map((fr) => Math.max(0, ...fr.boxes.map((b) => b.iou)));
console.log(`ceiling: correct ${ceil.filter((c) => c >= 0.9).length}/${frames.length}, mean IoU ${(ceil.reduce((a, b) => a + b, 0) / frames.length).toFixed(3)}`);
