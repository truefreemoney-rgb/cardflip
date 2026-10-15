// Runs the live-outline finder (findCardQuadNear) on the phone frames recorded
// by ?dbg=outline (POST /api/dev/outline-dump -> .outline-dumps/, gitignored),
// exactly as CameraCapture's sampler does, draws the result over each crop and
// prints a per-frame line. With labels.json beside it (stamp -> [L, R, T, B] in
// crop pixels, read off grid.mjs renders by eye), scores each labeled frame by
// IoU (>= 0.9 counts as correct). Switches: DETAIL=1 (the lines per side),
// PEAKS=left|right|top|bottom (every row's peaks), COMBOS=1 (every card-shaped
// combination weighed, against the label; needs trace.combos in the finder).
// Output: scripts/outline-eval/out/<stamp>.png. Run from the repo root:
//   node --experimental-strip-types scripts/outline-eval/eval.mjs [filter]
// 10-15 baseline on the ten labeled binder frames: 2 correct, mean IoU 0.73.
import { createRequire } from "node:module";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const sharp = require("sharp");
const pq = await import(new URL("../../src/lib/photoQuality.ts", import.meta.url).href);

const DUMPS = path.resolve(".outline-dumps");
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
await mkdir(OUT, { recursive: true });
const filter = process.argv[2] ?? "";
const files = (await readdir(DUMPS)).filter((f) => f.endsWith(".json") && f.includes(filter)).sort();

let found = 0, missed = 0, labeled = 0, correct = 0, iouSum = 0;
const labels = (() => { try { return JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "labels.json"), "utf8")); } catch { return {}; } })();
const SCALE = 3;
for (const f of files) {
  const stamp = f.replace(".json", "");
  const meta = JSON.parse(await readFile(path.join(DUMPS, f), "utf8"));
  if (!meta.crop) continue;
  const { sx, sy, sw, sh, w, h } = meta.crop;
  const img = sharp(path.join(DUMPS, `${stamp}.jpg`));
  const crop = img.extract({ left: Math.round(sx), top: Math.round(sy), width: Math.round(sw), height: Math.round(sh) }).resize(w, h, { fit: "fill" });
  const rgba = await crop.clone().ensureAlpha().raw().toBuffer();
  const gray = pq.toGray(rgba, w * h);
  const g = meta.geometry.video;
  const expect = { x: ((g.x - sx) / sw) * w, y: ((g.y - sy) / sh) * h, w: (g.w / sw) * w, h: (g.h / sh) * h };
  const grow = (sw / g.w) * (sh / g.h);
  const trace = { reason: "", T: 0, maxStep: 0, sides: "", ...(process.env.PEAKS ? { peaks: {} } : {}), ...(process.env.COMBOS ? { combos: [] } : {}) };
  const t0 = performance.now();
  const quad = pq.findCardQuadNear(gray, w, h, expect, 0.3 / grow, trace, null);
  const ms = (performance.now() - t0).toFixed(1);
  if (quad) found++; else missed++;
  let iouNote = "";
  const lab = labels[stamp.slice(11, 23)];
  if (lab) {
    labeled++;
    const [L, R, T, B] = lab;
    let iou = 0;
    if (quad) {
      const xs = quad.corners.map((p) => p.x), ys = quad.corners.map((p) => p.y);
      const l = Math.min(...xs), r = Math.max(...xs), t = Math.min(...ys), b = Math.max(...ys);
      const ix = Math.max(0, Math.min(r, R) - Math.max(l, L)), iy = Math.max(0, Math.min(b, B) - Math.max(t, T));
      const inter = ix * iy;
      iou = inter / ((r - l) * (b - t) + (R - L) * (B - T) - inter);
    }
    iouSum += iou;
    if (iou >= 0.9) correct++;
    iouNote = `  IoU ${iou.toFixed(2)}${iou >= 0.9 ? " OK" : " WRONG"}`;
  }
  const poly = quad ? quad.corners.map((p) => `${(p.x * SCALE).toFixed(1)},${(p.y * SCALE).toFixed(1)}`).join(" ") : "";
  const svg = `<svg width="${w * SCALE}" height="${h * SCALE}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${expect.x * SCALE}" y="${expect.y * SCALE}" width="${expect.w * SCALE}" height="${expect.h * SCALE}" fill="none" stroke="#a78bfa" stroke-width="2"/>
    ${quad ? `<polygon points="${poly}" fill="none" stroke="#34d399" stroke-width="3"/>` : ""}
    <text x="6" y="${h * SCALE - 8}" fill="#fde047" font-size="16" font-family="sans-serif">${stamp.slice(11, 23)} ${trace.reason} ${trace.sides} T${trace.T} ${quad ? `ang ${quad.angle.toFixed(1)}` : ""}</text>
  </svg>`;
  await crop.clone().resize(w * SCALE, h * SCALE, { kernel: "nearest" }).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(path.join(OUT, `${stamp.slice(11, 23)}.png`));
  console.log(`${stamp.slice(11, 23)}  ${trace.reason.padEnd(16)}${iouNote} ${trace.sides.padEnd(14)} T${String(trace.T).padStart(3)} ${ms}ms${quad ? `  ang ${quad.angle.toFixed(1)} area ${quad.area.toFixed(2)}` : ""}`);
  if (process.env.COMBOS && trace.combos && lab) {
    const [L, R, T, B] = lab;
    const score = (c) => { const xs = c.corners.map((p) => p.x), ys = c.corners.map((p) => p.y); const l = Math.min(...xs), r = Math.max(...xs), t = Math.min(...ys), b = Math.max(...ys); const ix = Math.max(0, Math.min(r, R) - Math.max(l, L)), iy = Math.max(0, Math.min(b, B) - Math.max(t, T)); const inter = ix * iy; return { iou: inter / ((r - l) * (b - t) + (R - L) * (B - T) - inter), l, r, t, b }; };
    const rows = trace.combos.map((c) => ({ c, ...score(c) })).sort((p, q) => (q.c.quality - 0.5 * q.c.runsOn) - (p.c.quality - 0.5 * p.c.runsOn));
    for (const { c, iou, l, r, t, b } of rows) console.log(`    ${c.picked ? ">>" : "  "} iou ${iou.toFixed(2)} q ${c.quality.toFixed(2)} run ${c.runsOn.toFixed(2)} sc ${(c.quality - 0.5 * c.runsOn).toFixed(2)} [${c.shares.map((v) => v.toFixed(2)).join(" ")}] asp ${(c.aspectErr * 100).toFixed(1)}% off ${c.off.toFixed(0)} area ${c.area.toFixed(2)} ang ${c.angle.toFixed(1)} L${l.toFixed(0)} R${r.toFixed(0)} T${t.toFixed(0)} B${b.toFixed(0)}`);
  }
  if (process.env.PEAKS) for (const row of trace.peaks[process.env.PEAKS] ?? []) console.log("    " + row);
  if (process.env.DETAIL) console.log(`    expect L${expect.x.toFixed(1)} R${(expect.x + expect.w).toFixed(1)} T${expect.y.toFixed(1)} B${(expect.y + expect.h).toFixed(1)}  ${trace.detail ?? ""}`);
}
console.log(`found ${found} / missed ${missed}` + (labeled ? `  labeled ${labeled}: correct ${correct}, mean IoU ${(iouSum / labeled).toFixed(3)}` : ""));
