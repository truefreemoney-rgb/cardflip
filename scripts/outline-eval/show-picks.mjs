// A montage of the labeled frames' working crops (224 wide, as the phone sees
// them) with the label (green box), pickCardCorners' pick (red) and every
// corner candidate (yellow dots, radius-sized), to see what the near-misses
// are. Run from the repo root:
//   node --experimental-strip-types scripts/outline-eval/show-picks.mjs <out.png> [filter]
// env: KEEP (6), MIN (20), PATCH (110), TUNE (JSON), SCALE (2 = crops drawn at 2x).
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
const out = process.argv[2] ?? path.join(HERE, "out", "picks.png");
const filter = process.argv[3] ?? "";
const PATCH = +(process.env.PATCH ?? 110), SPAN = 0.5;
const MIN = +(process.env.MIN ?? 20);
const KEEP = +(process.env.KEEP ?? 6);
const SCALE = +(process.env.SCALE ?? 2);
const TUNE = process.env.TUNE ? JSON.parse(process.env.TUNE) : {};
const files = (await readdir(DUMPS)).filter((f) => f.endsWith(".json") && f.includes(filter) && labels[f.slice(11, 23)]).sort();

async function patchesFor(img, FW, FH, g) {
  const half = g.w * SPAN / 2, scale = PATCH / (g.w * SPAN);
  const res = [];
  for (const [cx, cy] of [[g.x, g.y], [g.x + g.w, g.y], [g.x + g.w, g.y + g.h], [g.x, g.y + g.h]]) {
    const left = Math.max(0, Math.round(cx - half)), top = Math.max(0, Math.round(cy - half));
    const right = Math.min(FW, Math.round(cx + half)), bottom = Math.min(FH, Math.round(cy + half));
    const pw = Math.max(8, Math.round((right - left) * scale)), ph = Math.max(8, Math.round((bottom - top) * scale));
    const rgba = await img.clone().extract({ left, top, width: right - left, height: bottom - top }).resize(pw, ph, { fit: "fill" }).ensureAlpha().raw().toBuffer();
    res.push({ gray: pq.toGray(rgba, pw * ph), pw, ph, ox: left, oy: top, scale });
  }
  return res;
}
const tiles = [];
let TW = 0, TH = 0;
for (const f of files) {
  const stamp = f.replace(".json", "");
  const meta = JSON.parse(await readFile(path.join(DUMPS, f), "utf8"));
  if (!meta.crop) continue;
  const { sx, sy, sw, sh, w, h } = meta.crop;
  const g = meta.geometry.video;
  const img = sharp(path.join(DUMPS, `${stamp}.jpg`));
  const { width: FW, height: FH } = await img.metadata();
  const cropImg = img.clone().extract({ left: Math.round(sx), top: Math.round(sy), width: Math.round(sw), height: Math.round(sh) }).resize(w, h, { fit: "fill" });
  const rgba = await cropImg.clone().ensureAlpha().raw().toBuffer();
  const support = { gray: pq.toGray(rgba, w * h), w, h, sx, sy, sw, sh };
  const cands = pq.cardCornerCandidates(await patchesFor(img, FW, FH, g), g.w, KEEP);
  const pick = pq.pickCardCorners(cands, MIN, FW, FH, { support, tune: TUNE });
  const toCrop = (p) => ({ x: ((p.x - sx) / sw) * w * SCALE, y: ((p.y - sy) / sh) * h * SCALE });
  const short = stamp.slice(11, 23);
  const [L, R, T, B] = labels[short];
  let svg = `<svg width="${w * SCALE}" height="${h * SCALE}" xmlns="http://www.w3.org/2000/svg">`;
  // The guide, faint.
  const e = meta.expect;
  svg += `<rect x="${e.x * SCALE}" y="${e.y * SCALE}" width="${e.w * SCALE}" height="${e.h * SCALE}" fill="none" stroke="#a78bfa" stroke-width="1" stroke-dasharray="4 4"/>`;
  svg += `<rect x="${L * SCALE}" y="${T * SCALE}" width="${(R - L) * SCALE}" height="${(B - T) * SCALE}" fill="none" stroke="#22c55e" stroke-width="2"/>`;
  cands.forEach((list) => list.forEach((c, i) => {
    const p = toCrop(c);
    svg += `<circle cx="${p.x}" cy="${p.y}" r="${Math.max(2, (c.r / (sw / w)) * SCALE * 0.5)}" fill="none" stroke="${i === 0 ? "#facc15" : "#fde68a"}" stroke-width="${i === 0 ? 2 : 1}"/>`;
    svg += `<text x="${p.x + 4}" y="${p.y - 3}" font-size="9" fill="#fde68a" font-family="monospace">${c.score.toFixed(0)}</text>`;
  }));
  if (pick) {
    const pts = pick.quad.corners.map(toCrop).map((p) => `${p.x},${p.y}`).join(" ");
    svg += `<polygon points="${pts}" fill="none" stroke="#ef4444" stroke-width="2"/>`;
  }
  svg += `<text x="4" y="12" font-size="11" fill="#fff" font-family="monospace" stroke="#000" stroke-width="0.5">${short}${pick ? ` ${pick.fixes.map((x) => (x.score === -Infinity ? "-" : x.score.toFixed(0))).join("/")}` : " none"}</text></svg>`;
  const tile = await cropImg.resize(w * SCALE, h * SCALE, { fit: "fill" }).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
  tiles.push({ tile, w: w * SCALE, h: h * SCALE });
  TW = Math.max(TW, w * SCALE); TH = Math.max(TH, h * SCALE);
}
const cols = Math.min(6, tiles.length), rows = Math.ceil(tiles.length / cols);
const canvas = sharp({ create: { width: cols * TW, height: rows * TH, channels: 3, background: "#222" } });
await canvas.composite(tiles.map((t, i) => ({ input: t.tile, left: (i % cols) * TW, top: Math.floor(i / cols) * TH }))).png().toFile(out);
console.log(`wrote ${out} (${tiles.length} frames, ${cols}x${rows})`);
