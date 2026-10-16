// Per-box cues for "the page runs through this box", on the phone's own box per dump.
// node --experimental-strip-types feat.mjs <filter,...> [X=stamp,stamp,...]  (X = by-eye straddlers)
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
const INSET = 0.12, SPAN = 0.35;
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
  // Per line: edge share (perpendicular step >= 18 at +-2 px), std, mean.
  const line = (col, k) => {
    const n = 30; let e = 0, m = 0, sum = 0, sq = 0;
    const d = col ? 2 / W : 2 / H;
    for (let i = 0; i < n; i++) {
      const s = INSET + ((1 - 2 * INSET) * (i + 0.5)) / n;
      const a = col ? g(at(k - d, s)) : g(at(s, k - d)), b = col ? g(at(k + d, s)) : g(at(s, k + d)), v = col ? g(at(k, s)) : g(at(s, k));
      if ([a, b, v].some(Number.isNaN)) continue;
      m++; if (Math.abs(a - b) >= 18) e++; sum += v; sq += v * v;
    }
    if (m < n / 2) return null;
    const mean = sum / m;
    return { edge: e / m, sd: Math.sqrt(Math.max(0, sq / m - mean * mean)), mean };
  };
  const scan = (col, size) => {
    const steps = Math.round(size * 2 * SPAN); const out = [];
    for (let i = 0; i <= steps; i++) out.push(line(col, 0.5 - SPAN + (2 * SPAN * i) / steps));
    return out;
  };
  const feats = (ls) => {
    const edges = ls.map((l) => (l ? l.edge : 0));
    const maxEdge = Math.max(...edges);
    // Strip: two edge lines 4-30 px apart with quiet, flat lines between.
    let strip = 0, stripW = 0;
    for (let i = 0; i < ls.length; i++) {
      if (!ls[i] || ls[i].edge < 0.5) continue;
      for (let j = i + 4; j < Math.min(ls.length, i + 31); j++) {
        if (!ls[j] || ls[j].edge < 0.5) continue;
        const mid = ls.slice(i + 1, j).filter(Boolean);
        if (!mid.length) continue;
        const quiet = mid.reduce((a, l) => a + l.edge, 0) / mid.length;
        const flat = mid.reduce((a, l) => a + l.sd, 0) / mid.length;
        if (quiet <= 0.25 && flat <= 22) { const s = Math.min(ls[i].edge, ls[j].edge); if (s > strip) { strip = s; stripW = j - i; } }
      }
    }
    // Pair: two edge lines 4-30 px apart (no quiet requirement).
    let pair = 0;
    for (let i = 0; i < ls.length; i++) for (let j = i + 4; j < Math.min(ls.length, i + 31); j++) if (ls[i] && ls[j]) pair = Math.max(pair, Math.min(ls[i].edge, ls[j].edge));
    return { maxEdge, strip, stripW, pair };
  };
  const C = feats(scan(true, W)), R = feats(scan(false, H));
  const short = stamp.slice(11, 19);
  rows.push({ short, x: X.has(short) ? "X" : "S", C, R });
}
for (const r of rows) console.log(`${r.short} ${r.x}  col maxEdge ${r.C.maxEdge.toFixed(2)} strip ${r.C.strip.toFixed(2)}@${r.C.stripW} pair ${r.C.pair.toFixed(2)}  | row maxEdge ${r.R.maxEdge.toFixed(2)} strip ${r.R.strip.toFixed(2)}@${r.R.stripW} pair ${r.R.pair.toFixed(2)}`);
// Separation per feature: best threshold by accuracy.
const feats = [["colMaxEdge", (r) => r.C.maxEdge], ["colStrip", (r) => r.C.strip], ["colPair", (r) => r.C.pair], ["rowMaxEdge", (r) => r.R.maxEdge], ["rowStrip", (r) => r.R.strip], ["rowPair", (r) => r.R.pair], ["anyStrip", (r) => Math.max(r.C.strip, r.R.strip)], ["anyMaxEdge", (r) => Math.max(r.C.maxEdge, r.R.maxEdge)], ["colEdge|rowStrip", (r) => Math.max(r.C.maxEdge, r.R.strip)]];
if (X.size) for (const [name, fn] of feats) {
  let best = null;
  for (let th = 0.1; th <= 1; th += 0.05) {
    let tp = 0, fp = 0, fn_ = 0, tn = 0;
    for (const r of rows) { const flag = fn(r) >= th; if (r.x === "X") { if (flag) tp++; else fn_++; } else { if (flag) fp++; else tn++; } }
    const acc = (tp + tn) / rows.length;
    if (!best || acc > best.acc) best = { th: th.toFixed(2), acc, tp, fp, fn: fn_, tn };
  }
  console.log(name.padEnd(16), JSON.stringify(best));
}
