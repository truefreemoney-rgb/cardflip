// Full-res views of a frame's four corners round a guessed label, to read the
// card's exact edges off: a 2x2 montage, each tile 34 crop px square at the
// frame's own resolution (about 7.5 frame px per crop px), with a ruler in
// CROP pixels (tick each px, number every 5) and the guess as a red cross.
// node label-corners.mjs <stamp> L R T B <out.png>
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const require = createRequire("file:///C:/Users/Chris/cardflip/package.json");
const sharp = require("sharp");
const D = "C:/Users/Chris/cardflip/.outline-dumps/";
const [stamp, Ls, Rs, Ts, Bs, out] = process.argv.slice(2);
const L = +Ls, R = +Rs, T = +Ts, B = +Bs;
const meta = JSON.parse(await readFile(D + stamp + ".json", "utf8"));
const { sx, sy, sw, sh, w, h } = meta.crop;
const kx = sw / w, ky = sh / h; // frame px per crop px
const img = sharp(D + stamp + ".jpg");
const { width: FW, height: FH } = await img.metadata();
const HALF = 17; // crop px each side
const tiles = [];
const guesses = [[L, T], [R, T], [R, B], [L, B]];
let tw = 0, th = 0;
for (const [gx, gy] of guesses) {
  const x0 = Math.max(0, Math.round(sx + (gx - HALF) * kx)), y0 = Math.max(0, Math.round(sy + (gy - HALF) * ky));
  const x1 = Math.min(FW, Math.round(sx + (gx + HALF) * kx)), y1 = Math.min(FH, Math.round(sy + (gy + HALF) * ky));
  const pw = x1 - x0, ph = y1 - y0;
  tw = Math.max(tw, pw); th = Math.max(th, ph);
  const marks = [];
  const c0 = Math.ceil((x0 - sx) / kx), c1 = Math.floor((x1 - sx) / kx);
  for (let c = c0; c <= c1; c++) {
    const px = (sx + c * kx) - x0;
    const major = c % 5 === 0;
    marks.push(`<line x1="${px}" y1="0" x2="${px}" y2="${major ? 16 : 7}" stroke="#ff0" stroke-width="1.5"/>`);
    if (major) marks.push(`<text x="${px + 2}" y="28" fill="#ff0" font-size="13" font-family="sans-serif">${c}</text>`);
  }
  const r0 = Math.ceil((y0 - sy) / ky), r1 = Math.floor((y1 - sy) / ky);
  for (let r = r0; r <= r1; r++) {
    const py = (sy + r * ky) - y0;
    const major = r % 5 === 0;
    marks.push(`<line x1="0" y1="${py}" x2="${major ? 16 : 7}" y2="${py}" stroke="#0ff" stroke-width="1.5"/>`);
    if (major) marks.push(`<text x="20" y="${py + 5}" fill="#0ff" font-size="13" font-family="sans-serif">${r}</text>`);
  }
  const cx = (sx + gx * kx) - x0, cy = (sy + gy * ky) - y0;
  marks.push(`<line x1="${cx - 12}" y1="${cy}" x2="${cx + 12}" y2="${cy}" stroke="#f00" stroke-width="1.5"/><line x1="${cx}" y1="${cy - 12}" x2="${cx}" y2="${cy + 12}" stroke="#f00" stroke-width="1.5"/>`);
  const svg = `<svg width="${pw}" height="${ph}" xmlns="http://www.w3.org/2000/svg">${marks.join("")}</svg>`;
  tiles.push(await img.clone().extract({ left: x0, top: y0, width: pw, height: ph }).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer());
}
await sharp({ create: { width: tw * 2 + 6, height: th * 2 + 6, channels: 3, background: "#000" } })
  .composite([{ input: tiles[0], left: 0, top: 0 }, { input: tiles[1], left: tw + 6, top: 0 }, { input: tiles[3], left: 0, top: th + 6 }, { input: tiles[2], left: tw + 6, top: th + 6 }])
  .png().toFile(out);
console.log("wrote", out, `${tw * 2 + 6}x${th * 2 + 6}`);
