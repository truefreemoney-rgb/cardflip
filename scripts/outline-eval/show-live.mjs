// A montage of recorded phone frames (working crop, 224 wide) with what the
// PHONE found on them: the dump's own quad (red = the box found on this frame),
// every tick quad saved with the dump (thin yellow = the boxes of the 2 s before
// it, so a steady box reads as one line and a wandering one as a smear) and the
// guide (dashed violet). Prints per frame: mean brightness of the crop, the
// dump's trace reason, and how many ticks were tracked (T) / fresh (F) / lost.
// No labels needed, so it works on any round. Run from the repo root:
//   node scripts/outline-eval/show-live.mjs <out.png> <stampFilter> [cols]
// env: SCALE (2), TICKS=0 (skip the tick quads).
import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
const sharp = require("sharp");
const DUMPS = path.resolve(".outline-dumps");
const out = process.argv[2];
const filter = process.argv[3] ?? "";
const COLS = +(process.argv[4] ?? 6);
const SCALE = +(process.env.SCALE ?? 2);
const TICKS = process.env.TICKS !== "0";
if (!out || !filter) { console.error("usage: show-live.mjs <out.png> <stampFilter> [cols]"); process.exit(1); }
// The filter is a comma list of substrings (a round that spans minutes: "04-21,04-22,04-23").
const parts = filter.split(",");
const files = (await readdir(DUMPS)).filter((f) => f.endsWith(".json") && parts.some((p) => f.includes(p))).sort();
const tiles = [];
let TW = 0, TH = 0;
const pts = (q, s) => q.map((p) => `${(p.x * s).toFixed(1)},${(p.y * s).toFixed(1)}`).join(" ");
for (const f of files) {
  const stamp = f.replace(".json", "");
  const meta = JSON.parse(await readFile(path.join(DUMPS, f), "utf8"));
  if (!meta.crop) continue;
  const { sx, sy, sw, sh, w, h } = meta.crop;
  const img = sharp(path.join(DUMPS, `${stamp}.jpg`));
  const cropImg = img.clone().extract({ left: Math.round(sx), top: Math.round(sy), width: Math.round(sw), height: Math.round(sh) }).resize(w, h, { fit: "fill" });
  const gray = await cropImg.clone().greyscale().raw().toBuffer();
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const bright = sum / gray.length;
  const short = stamp.slice(11, 23);
  let svg = `<svg width="${w * SCALE}" height="${h * SCALE}" xmlns="http://www.w3.org/2000/svg">`;
  const e = meta.expect;
  if (e) svg += `<rect x="${e.x * SCALE}" y="${e.y * SCALE}" width="${e.w * SCALE}" height="${e.h * SCALE}" fill="none" stroke="#a78bfa" stroke-width="1" stroke-dasharray="4 4"/>`;
  let T = 0, F = 0, lost = 0, G = 0;
  for (const t of meta.ticks ?? []) {
    const r = t.reason ?? "";
    const flag = r.split(" ")[2];
    if (!t.quad) lost++;
    else if (flag === "T") T++;
    else if (flag === "F") F++;
    // Ticks whose fix earned green (dumps from 10-16 on carry `ready`).
    if (t.ready === true) G++;
    if (TICKS && t.quad) svg += `<polygon points="${pts(t.quad, SCALE)}" fill="none" stroke="#fde047" stroke-width="1" opacity="0.55"/>`;
  }
  if (meta.quad?.corners) svg += `<polygon points="${pts(meta.quad.corners, SCALE)}" fill="none" stroke="#ef4444" stroke-width="2"/>`;
  const reason = meta.trace?.reason ?? "";
  svg += `<text x="4" y="12" font-size="11" fill="#fff" font-family="monospace" stroke="#000" stroke-width="0.5">${short} L${bright.toFixed(0)}</text>`;
  svg += `<text x="4" y="${h * SCALE - 6}" font-size="10" fill="#fff" font-family="monospace" stroke="#000" stroke-width="0.5">${reason.slice(0, 34)} T${T} F${F} -${lost} G${G}</text></svg>`;
  console.log(`${short}  L${bright.toFixed(0).padStart(3)}  ticks T${String(T).padStart(2)} F${String(F).padStart(2)} lost${String(lost).padStart(2)} green${String(G).padStart(2)}  ${reason}`);
  const tile = await cropImg.resize(w * SCALE, h * SCALE, { fit: "fill" }).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
  tiles.push({ tile, w: w * SCALE, h: h * SCALE });
  TW = Math.max(TW, w * SCALE); TH = Math.max(TH, h * SCALE);
}
const cols = Math.min(COLS, tiles.length), rows = Math.ceil(tiles.length / cols);
const canvas = sharp({ create: { width: cols * TW, height: rows * TH, channels: 3, background: "#222" } });
await canvas.composite(tiles.map((t, i) => ({ input: t.tile, left: (i % cols) * TW, top: Math.floor(i / cols) * TH }))).png().toFile(out);
console.log(`wrote ${out} (${tiles.length} frames, ${cols}x${rows})`);
