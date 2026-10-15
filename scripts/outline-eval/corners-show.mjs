// A 2x2 montage of the four corner patches (4x) for one frame: the found corner (red cross + its arc + edge
// samples) and the label's corner (green cross). Usage: node --experimental-strip-types scripts/outline-eval/corners-show.mjs <stamp12> <out.png>
import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const sharp = require("sharp");
const pq = await import(new URL("../../src/lib/photoQuality.ts", import.meta.url).href);
const here = path.dirname(fileURLToPath(import.meta.url));
const DUMPS = path.resolve(".outline-dumps");
const labels = JSON.parse(readFileSync(path.join(here, "labels.json"), "utf8"));
const [short, out] = process.argv.slice(2);
const PATCH = +(process.env.PATCH ?? 124), SPAN = +(process.env.SPAN ?? 0.44), Z = 4;
const f = (await readdir(DUMPS)).find((x) => x.includes(short) && x.endsWith(".json"));
const stamp = f.replace(".json", "");
const meta = JSON.parse(await readFile(path.join(DUMPS, f), "utf8"));
const { sx, sy, sw, sh, w, h } = meta.crop;
const g = meta.geometry.video;
const img = sharp(path.join(DUMPS, `${stamp}.jpg`));
const { width: FW, height: FH } = await img.metadata();
const corners = [[g.x, g.y], [g.x + g.w, g.y], [g.x + g.w, g.y + g.h], [g.x, g.y + g.h]];
const patches = [], pngs = [];
for (const [cx, cy] of corners) {
  const half = g.w * SPAN / 2;
  const left = Math.max(0, Math.round(cx - half)), top = Math.max(0, Math.round(cy - half));
  const right = Math.min(FW, Math.round(cx + half)), bottom = Math.min(FH, Math.round(cy + half));
  const rw = right - left, rh = bottom - top, scale = PATCH / (g.w * SPAN);
  const pw = Math.max(8, Math.round(rw * scale)), ph = Math.max(8, Math.round(rh * scale));
  const rgba = await img.clone().extract({ left, top, width: rw, height: rh }).resize(pw, ph, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  patches.push({ gray: pq.toGray(rgba, pw * ph), pw, ph, ox: left, oy: top, scale });
  pngs.push(await img.clone().extract({ left, top, width: rw, height: rh }).resize(pw * Z, ph * Z, { kernel: "nearest" }).png().toBuffer());
}
const fixes = pq.findCardCorners(patches, g.w);
const lab = labels[short];
const dirs = [[[1, 0], [0, 1]], [[-1, 0], [0, 1]], [[-1, 0], [0, -1]], [[1, 0], [0, -1]]];
const tiles = [];
for (let k = 0; k < 4; k++) {
  const p = patches[k], c = fixes[k];
  const px = (c.x - p.ox) * p.scale * Z, py = (c.y - p.oy) * p.scale * Z, r = c.r * p.scale * Z;
  const [u, v] = dirs[k];
  const ccx = px + (u[0] + v[0]) * r, ccy = py + (u[1] + v[1]) * r;
  let svg = `<svg width="${p.pw * Z}" height="${p.ph * Z}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<line x1="${px - 8}" y1="${py}" x2="${px + 8}" y2="${py}" stroke="#f00" stroke-width="2"/><line x1="${px}" y1="${py - 8}" x2="${px}" y2="${py + 8}" stroke="#f00" stroke-width="2"/>`;
  svg += `<circle cx="${ccx}" cy="${ccy}" r="${r}" fill="none" stroke="#f00" stroke-width="1.5" stroke-dasharray="3 3"/>`;
  svg += `<line x1="${px + u[0] * r * 1.15}" y1="${py + u[1] * r * 1.15}" x2="${px + u[0] * r * 3}" y2="${py + u[1] * r * 3}" stroke="#ff0" stroke-width="2"/><line x1="${px + v[0] * r * 1.15}" y1="${py + v[1] * r * 1.15}" x2="${px + v[0] * r * 3}" y2="${py + v[1] * r * 3}" stroke="#ff0" stroke-width="2"/>`;
  if (lab) {
    const [L, R, T, B] = lab;
    const lx = [L, R, R, L][k], ly = [T, T, B, B][k];
    const fx = sx + lx * (sw / w), fy = sy + ly * (sh / h);
    const gx = (fx - p.ox) * p.scale * Z, gy = (fy - p.oy) * p.scale * Z;
    svg += `<line x1="${gx - 8}" y1="${gy}" x2="${gx + 8}" y2="${gy}" stroke="#0f0" stroke-width="2"/><line x1="${gx}" y1="${gy - 8}" x2="${gx}" y2="${gy + 8}" stroke="#0f0" stroke-width="2"/>`;
  }
  svg += `<text x="4" y="14" fill="#0ff" font-size="12" font-family="sans-serif">${"TL TR BR BL".split(" ")[k]} s${c.score.toFixed(1)} r${(c.r / (sw / w)).toFixed(1)}</text></svg>`;
  tiles.push(await sharp(pngs[k]).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer());
}
const tw = patches[0].pw * Z, th = patches[0].ph * Z;
await sharp({ create: { width: tw * 2 + 4, height: th * 2 + 4, channels: 3, background: "#000" } })
  .composite([{ input: tiles[0], left: 0, top: 0 }, { input: tiles[1], left: tw + 4, top: 0 }, { input: tiles[3], left: 0, top: th + 4 }, { input: tiles[2], left: tw + 4, top: th + 4 }])
  .png().toFile(out);
console.log("wrote", out);
