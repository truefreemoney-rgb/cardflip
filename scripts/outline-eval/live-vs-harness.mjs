// Does the harness see what the phone saw? For each dump whose live tick came
// from the corner finder, run the same finder (patches exactly as
// CameraCapture.cornersFromSource: PATCH 110, half a guide width wide) on the
// dump's JPEG and compare with the quad the phone computed on that frame.
// PERTURB=1 also shifts the patch windows a few frame px each way (what a
// moving hand does between ticks) and reports how far the pick moves.
// Run from the repo root: node --experimental-strip-types live-vs-harness.mjs [filter]
import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire("file:///C:/Users/Chris/cardflip/package.json");
const sharp = require("sharp");
const pq = await import("file:///C:/Users/Chris/cardflip/src/lib/photoQuality.ts");
const DUMPS = "C:/Users/Chris/cardflip/.outline-dumps";
const filter = process.argv[2] ?? "2026-10-16T02-3";
const PATCH = +(process.env.PATCH ?? 110);
const SPAN = +(process.env.SPAN ?? 0.5);
const KERNEL = process.env.KERNEL ?? "lanczos3";
const MIN = +(process.env.MIN ?? 20);
const KEEP = +(process.env.KEEP ?? 6);
const files = (await readdir(DUMPS)).filter((f) => f.endsWith(".json") && f.includes(filter)).sort();
const NAMES = ["TL", "TR", "BR", "BL"];

async function patchesFor(img, FW, FH, g, dx = 0, dy = 0) {
  const half = g.w * SPAN / 2;
  const scale = PATCH / (g.w * SPAN);
  const out = [];
  for (const [cx0, cy0] of [[g.x, g.y], [g.x + g.w, g.y], [g.x + g.w, g.y + g.h], [g.x, g.y + g.h]]) {
    const cx = cx0 + dx, cy = cy0 + dy;
    const left = Math.max(0, Math.round(cx - half)), top = Math.max(0, Math.round(cy - half));
    const right = Math.min(FW, Math.round(cx + half)), bottom = Math.min(FH, Math.round(cy + half));
    const pw = Math.max(8, Math.round((right - left) * scale)), ph = Math.max(8, Math.round((bottom - top) * scale));
    const rgba = await img.clone().extract({ left, top, width: right - left, height: bottom - top }).resize(pw, ph, { fit: "fill", kernel: KERNEL }).ensureAlpha().raw().toBuffer();
    out.push({ gray: pq.toGray(rgba, pw * ph), pw, ph, ox: left, oy: top, scale });
  }
  return out;
}
const iouOf = (qa, qb) => {
  const box = (q) => { const xs = q.map((p) => p.x), ys = q.map((p) => p.y); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; };
  const [l, r, t, b] = box(qa), [L, R, T, B] = box(qb);
  const ix = Math.max(0, Math.min(r, R) - Math.max(l, L)), iy = Math.max(0, Math.min(b, B) - Math.max(t, T));
  const inter = ix * iy;
  return inter / ((r - l) * (b - t) + (R - L) * (B - T) - inter);
};
let n = 0, iouSum = 0, agree = 0, pertSpreads = [];
for (const f of files) {
  const stamp = f.replace(".json", "");
  const meta = JSON.parse(await readFile(path.join(DUMPS, f), "utf8"));
  if (!meta.crop || !meta.quad || !(meta.trace?.reason ?? "").startsWith("corners")) continue;
  const { sx, sy, sw, sh, w, h } = meta.crop;
  const g = meta.geometry.video;
  const img = sharp(path.join(DUMPS, `${stamp}.jpg`));
  const { width: FW, height: FH } = await img.metadata();
  const toCrop = (c) => ({ x: ((c.x - sx) / sw) * w, y: ((c.y - sy) / sh) * h });
  const run = async (dx, dy) => {
    const patches = await patchesFor(img, FW, FH, g, dx, dy);
    const pick = pq.pickCardCorners(pq.cardCornerCandidates(patches, g.w, KEEP), MIN, FW, FH);
    return pick ? { corners: pick.quad.corners.map(toCrop), scores: pick.fixes.map((x) => (x.score === -Infinity ? 0 : x.score)) } : null;
  };
  const base = await run(0, 0);
  const live = meta.quad.corners;
  const short = stamp.slice(11, 23);
  if (!base) { console.log(`${short}  harness: none   live ${meta.trace.reason}`); n++; continue; }
  const iou = iouOf(base.corners, live);
  const dists = base.corners.map((p, i) => Math.hypot(p.x - live[i].x, p.y - live[i].y) / meta.expect.w * 100);
  n++; iouSum += iou; if (iou >= 0.95) agree++;
  let pert = "";
  if (process.env.PERTURB) {
    const picks = [];
    for (const [dx, dy] of [[-4, 0], [4, 0], [0, -4], [0, 4], [-8, 0], [8, 0]]) { const p = await run(dx, dy); if (p) picks.push(p.corners); }
    const spread = picks.length ? Math.max(...picks.map((q) => Math.max(...q.map((p, i) => Math.hypot(p.x - base.corners[i].x, p.y - base.corners[i].y))))) / meta.expect.w * 100 : NaN;
    pertSpreads.push(spread);
    pert = `  shifted-window max move ${spread.toFixed(1)}% (${picks.length}/6 found)`;
  }
  console.log(`${short}  IoU vs live ${iou.toFixed(2)}  corner dist % ${dists.map((d) => d.toFixed(1).padStart(5)).join(" ")}  live ${meta.trace.reason.padEnd(22)} harness corners ${base.scores.map((s) => s.toFixed(0)).join("/")}${pert}`);
}
const med = (a) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
console.log(`frames ${n}: mean IoU vs live ${(iouSum / Math.max(1, n)).toFixed(3)}, same box (>=0.95) ${agree}` + (pertSpreads.length ? `; shifted-window move median ${med(pertSpreads).toFixed(1)}%` : ""));
