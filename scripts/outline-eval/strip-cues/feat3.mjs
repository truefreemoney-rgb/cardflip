// Tilt-tolerant "page strip through the box": lines across the middle of the box, each tried at 5 slopes,
// smooth (low roughness along it) and going on past the box at both ends with the same gray.
// node --experimental-strip-types feat3.mjs <filter,...> [X=stamp,...]   env: R (rough limit, 7) NEAR (25) INSET SPAN
import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire("file:///C:/Users/Chris/cardflip/package.json");
const sharp = require("sharp");
const DUMPS = "C:/Users/Chris/cardflip/.outline-dumps";
const [filter, xs] = process.argv.slice(2);
const X = new Set((xs ?? "").replace(/^X=/, "").split(",").filter(Boolean));
const parts = filter.split(",");
const files = (await readdir(DUMPS)).filter((f) => f.endsWith(".json") && parts.some((p) => f.includes(p))).sort();
const INSET = +(process.env.INSET ?? 0.12), SPAN = +(process.env.SPAN ?? 0.35), R = +(process.env.R ?? 7), NEAR = +(process.env.NEAR ?? 25);
const SLOPES = [-0.1, -0.05, 0, 0.05, 0.1];
const rows = [];
for (const f of files) {
  const stamp = f.replace(".json", "");
  const meta = JSON.parse(await readFile(path.join(DUMPS, f), "utf8"));
  const quad = meta.quad?.corners ?? meta.quad;
  if (!meta.crop || !Array.isArray(quad)) continue;
  const { sx, sy, sw, sh, w, h } = meta.crop;
  const gray = new Uint8Array(await sharp(path.join(DUMPS, `${stamp}.jpg`)).extract({ left: Math.round(sx), top: Math.round(sy), width: Math.round(sw), height: Math.round(sh) }).resize(w, h, { fit: "fill" }).greyscale().raw().toBuffer());
  const c = quad;
  const at = (u, v) => { const tx = c[0].x + (c[1].x - c[0].x) * u, ty = c[0].y + (c[1].y - c[0].y) * u; const bx = c[3].x + (c[2].x - c[3].x) * u, by = c[3].y + (c[2].y - c[3].y) * u; return { x: tx + (bx - tx) * v, y: ty + (by - ty) * v }; };
  const g = (p) => { const x = Math.round(p.x), y = Math.round(p.y); return x < 0 || y < 0 || x >= w || y >= h ? NaN : gray[y * w + x]; };
  const W = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y), H = Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y);
  // A line at k across the box (col: u = k, v runs; row: v = k, u runs), tilted by slope (k shifts by -slope/2..+slope/2 along it).
  const line = (col, k, slope) => {
    const n = 24; const vals = [];
    for (let i = 0; i < n; i++) {
      const s = INSET + ((1 - 2 * INSET) * (i + 0.5)) / n;
      const kk = k + slope * (s - 0.5);
      const v = col ? g(at(kk, s)) : g(at(s, kk));
      if (!Number.isNaN(v)) vals.push(v);
    }
    if (vals.length < n / 2) return null;
    let rough = 0; for (let i = 1; i < vals.length; i++) rough += Math.abs(vals[i] - vals[i - 1]); rough /= vals.length - 1;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    let seen = 0, same = 0;
    for (const e of [-0.08, -0.04, 1.04, 1.08]) {
      const kk = k + slope * (e - 0.5);
      const v = col ? g(at(kk, e)) : g(at(e, kk));
      if (Number.isNaN(v)) continue;
      seen++; if (Math.abs(v - mean) < NEAR) same++;
    }
    return { rough, sd, mean, ends: seen >= 2 && same >= Math.ceil(seen * 0.75) };
  };
  const scan = (col, size) => {
    const steps = Math.round(size * 2 * SPAN); const out = [];
    for (let i = 0; i <= steps; i++) {
      const k = 0.5 - SPAN + (2 * SPAN * i) / steps;
      let best = null;
      for (const sl of SLOPES) { const l = line(col, k, sl); if (l && l.ends && (!best || l.rough < best.rough)) best = l; }
      out.push(best);
    }
    return out;
  };
  const longest = (ls, size) => { let best = 0, run = 0, minR = 99; for (const l of ls) { if (l) minR = Math.min(minR, l.rough); if (l && l.rough < R) best = Math.max(best, ++run); else run = 0; } return { run: best / size, px: best, minR }; };
  const C = longest(scan(true, W), W), Rw = longest(scan(false, H), H);
  const short = stamp.slice(11, 19);
  rows.push({ short, x: X.has(short) ? "X" : "S", C, R: Rw });
}
for (const r of rows) console.log(`${r.short} ${r.x}  col run ${r.C.run.toFixed(3)} (${r.C.px}px) minRough ${r.C.minR.toFixed(1)}  | row run ${r.R.run.toFixed(3)} (${r.R.px}px) minRough ${r.R.minR.toFixed(1)}`);
const feats = [["colRun", (r) => r.C.run], ["rowRun", (r) => r.R.run], ["anyRun", (r) => Math.max(r.C.run, r.R.run)]];
if (X.size) for (const [name, fn] of feats) {
  let best = null;
  for (let th = 0.005; th <= 0.2; th += 0.005) {
    let tp = 0, fp = 0, fn_ = 0, tn = 0;
    for (const r of rows) { const flag = fn(r) >= th; if (r.x === "X") { if (flag) tp++; else fn_++; } else { if (flag) fp++; else tn++; } }
    const acc = (tp + tn) / rows.length;
    if (!best || acc > best.acc) best = { th: th.toFixed(3), acc: +acc.toFixed(2), tp, fp, fn: fn_, tn };
  }
  console.log(name.padEnd(8), JSON.stringify(best));
}
