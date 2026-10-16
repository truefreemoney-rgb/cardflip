// Signed cues: a seam is an edge of one sign along its whole length; a pocket gap is two such edges of opposite sign, 4-30 px apart, flat between.
// node --experimental-strip-types feat2.mjs <filter,...> [X=stamp,...]
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
const INSET = +(process.env.INSET ?? 0.12), SPAN = +(process.env.SPAN ?? 0.35), D = +(process.env.D ?? 2), MAG = +(process.env.MAG ?? 12);
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
  // Per line: signed step across it at +-D px: consistency |sum|/sum|.|, share of big steps, mean |step|.
  const line = (col, k) => {
    const n = 30; let m = 0, sum = 0, abs = 0, big = 0;
    const d = col ? D / W : D / H;
    for (let i = 0; i < n; i++) {
      const s = INSET + ((1 - 2 * INSET) * (i + 0.5)) / n;
      const a = col ? g(at(k - d, s)) : g(at(s, k - d)), b = col ? g(at(k + d, s)) : g(at(s, k + d));
      if (Number.isNaN(a) || Number.isNaN(b)) continue;
      const st = b - a; m++; sum += st; abs += Math.abs(st); if (Math.abs(st) >= MAG) big++;
    }
    if (m < n / 2) return null;
    return { cons: abs ? Math.abs(sum) / abs : 0, big: big / m, mag: abs / m, sign: Math.sign(sum) };
  };
  const scan = (col, size) => { const steps = Math.round(size * 2 * SPAN); const out = []; for (let i = 0; i <= steps; i++) out.push(line(col, 0.5 - SPAN + (2 * SPAN * i) / steps)); return out; };
  const feats = (ls) => {
    // Edge line strength = cons * big (1 = a clean straight edge all along).
    const str = ls.map((l) => (l ? l.cons * l.big : 0));
    const maxLine = Math.max(...str);
    let band = 0, bandW = 0;
    for (let i = 0; i < ls.length; i++) {
      if (!ls[i] || str[i] < 0.3) continue;
      for (let j = i + 4; j < Math.min(ls.length, i + 31); j++) {
        if (!ls[j] || str[j] < 0.3 || ls[j].sign === ls[i].sign) continue;
        const mid = ls.slice(i + 2, j - 1).filter(Boolean);
        if (!mid.length) continue;
        const flat = mid.reduce((a, l) => a + l.mag, 0) / mid.length;
        if (flat > 10) continue;
        const s = Math.min(str[i], str[j]);
        if (s > band) { band = s; bandW = j - i; }
      }
    }
    return { maxLine, band, bandW };
  };
  const C = feats(scan(true, W)), R = feats(scan(false, H));
  const short = stamp.slice(11, 19);
  rows.push({ short, x: X.has(short) ? "X" : "S", C, R });
}
for (const r of rows) console.log(`${r.short} ${r.x}  col line ${r.C.maxLine.toFixed(2)} band ${r.C.band.toFixed(2)}@${r.C.bandW}  | row line ${r.R.maxLine.toFixed(2)} band ${r.R.band.toFixed(2)}@${r.R.bandW}`);
const feats = [["colLine", (r) => r.C.maxLine], ["colBand", (r) => r.C.band], ["rowLine", (r) => r.R.maxLine], ["rowBand", (r) => r.R.band], ["anyBand", (r) => Math.max(r.C.band, r.R.band)], ["colLine|rowBand", (r) => Math.max(r.C.maxLine, r.R.band)]];
if (X.size) for (const [name, fn] of feats) {
  let best = null;
  for (let th = 0.1; th <= 1; th += 0.05) {
    let tp = 0, fp = 0, fn_ = 0, tn = 0;
    for (const r of rows) { const flag = fn(r) >= th; if (r.x === "X") { if (flag) tp++; else fn_++; } else { if (flag) fp++; else tn++; } }
    const acc = (tp + tn) / rows.length;
    if (!best || acc > best.acc) best = { th: th.toFixed(2), acc: +acc.toFixed(2), tp, fp, fn: fn_, tn };
  }
  console.log(name.padEnd(16), JSON.stringify(best));
}
