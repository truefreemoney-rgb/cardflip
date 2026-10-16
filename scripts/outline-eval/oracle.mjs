// The picker's ceiling: for each labeled frame, how close the NEAREST corner
// candidate is to the label at each corner, and its rank in the list. If
// the true corner is not among the candidates no picker can find it (then
// KEEP, SPAN or the detector must change, not pickCardCorners).
// Run from the repo root: node --experimental-strip-types scripts/outline-eval/oracle.mjs
// env: PATCH (110), SPAN (0.5), KEEP (6). A hit = within 4 % of the guide width.
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
const PATCH = +(process.env.PATCH ?? 110);
const SPAN = +(process.env.SPAN ?? 0.5);
const KEEP = +(process.env.KEEP ?? 6);
const APART = +(process.env.APART ?? 1);
const HIT = +(process.env.HIT ?? 4);
const boxOf = (q) => { const xs = q.map((p) => p.x), ys = q.map((p) => p.y); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; };
const iouBox = ([l, r, t, b], [L, R, T, B]) => {
  const ix = Math.max(0, Math.min(r, R) - Math.max(l, L)), iy = Math.max(0, Math.min(b, B) - Math.max(t, T));
  const inter = ix * iy;
  return inter / ((r - l) * (b - t) + (R - L) * (B - T) - inter);
};
// The best box the candidates allow: the nearest candidate at each corner, or three of them with the fourth completed.
const ceiling = (near, lab) => {
  let best = iouBox(boxOf(near), lab);
  for (let m = 0; m < 4; m++) {
    const pts = near.map((p) => ({ ...p }));
    const prev = pts[(m + 3) % 4], next = pts[(m + 1) % 4], opp = pts[(m + 2) % 4];
    pts[m] = { x: prev.x + next.x - opp.x, y: prev.y + next.y - opp.y };
    best = Math.max(best, iouBox(boxOf(pts), lab));
  }
  return best;
};
const files = (await readdir(DUMPS)).filter((f) => f.endsWith(".json") && labels[f.slice(11, 23)]).sort();
const NAMES = ["TL", "TR", "BR", "BL"];

async function patchesFor(img, FW, FH, g) {
  const half = g.w * SPAN / 2;
  const scale = PATCH / (g.w * SPAN);
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
const nearest = [[], [], [], []], ranks = [[], [], [], []];
// Signed offset of the nearest candidate from the label (crop px, +x right, +y down), per corner.
const offX = [[], [], [], []], offY = [[], [], [], []], offR = [[], [], [], []];
let frames = 0, allFour = 0, threeOf = 0;
const ceilings = [];
for (const f of files) {
  const stamp = f.replace(".json", "");
  const meta = JSON.parse(await readFile(path.join(DUMPS, f), "utf8"));
  if (!meta.crop) continue;
  const { sx, sy, sw, sh, w, h } = meta.crop;
  const g = meta.geometry.video;
  const img = sharp(path.join(DUMPS, `${stamp}.jpg`));
  const { width: FW, height: FH } = await img.metadata();
  const cands = pq.cardCornerCandidates(await patchesFor(img, FW, FH, g), g.w, KEEP, APART);
  const short = stamp.slice(11, 23);
  const [L, R, T, B] = labels[short];
  const labC = [[L, T], [R, T], [R, B], [L, B]];
  let hits = 0;
  const parts = [];
  const near = [];
  cands.forEach((list, k) => {
    let best = Infinity, rank = -1, bx = 0, by = 0, br = 0;
    list.forEach((c, i) => {
      const cx = ((c.x - sx) / sw) * w, cy = ((c.y - sy) / sh) * h;
      const d = Math.hypot(cx - labC[k][0], cy - labC[k][1]) / meta.expect.w * 100;
      if (d < best) { best = d; rank = i; bx = cx - labC[k][0]; by = cy - labC[k][1]; br = c.r / (sw / w); }
    });
    near.push({ x: labC[k][0] + bx, y: labC[k][1] + by });
    nearest[k].push(best);
    if (rank >= 0) { offX[k].push(bx); offY[k].push(by); offR[k].push(br); }
    if (best <= HIT) { hits++; ranks[k].push(rank); }
    parts.push(`${NAMES[k]} ${best === Infinity ? "  --" : best.toFixed(1).padStart(4)}%${rank >= 0 ? `#${rank}` : "  "} s${rank >= 0 ? list[rank].score.toFixed(0).padStart(3) : "  -"} (${bx >= 0 ? "+" : ""}${bx.toFixed(0)},${by >= 0 ? "+" : ""}${by.toFixed(0)})`);
  });
  frames++;
  if (hits === 4) allFour++;
  if (hits >= 3) threeOf++;
  const ceil = ceiling(near, labels[short]);
  ceilings.push(ceil);
  if (!process.env.QUIET) console.log(`${short}  ${parts.join("  ")}  ${hits}/4 within ${HIT}%  ceiling IoU ${ceil.toFixed(2)}`);
}
console.log(`KEEP ${KEEP} APART ${APART} SPAN ${SPAN} PATCH ${PATCH} | frames ${frames}: all four corners present ${allFour}, three or more ${threeOf} | nearest-candidate error med % ${nearest.map((c) => med(c).toFixed(1)).join("/")} | rank of the true corner med ${ranks.map((r) => (r.length ? med(r) : "-")).join("/")} | CEILING: correct ${ceilings.filter((c) => c >= 0.9).length}/${frames}, mean IoU ${(ceilings.reduce((a, b) => a + b, 0) / frames).toFixed(3)}`);
console.log(`nearest candidate's signed offset from the label, median crop px (dx,dy): ${NAMES.map((n, k) => `${n} (${med(offX[k]).toFixed(1)},${med(offY[k]).toFixed(1)})`).join("  ")} | fitted radius med crop px ${offR.map((r) => med(r).toFixed(1)).join("/")}`);
