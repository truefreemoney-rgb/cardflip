// The crop at 3x with a 10 px grid (labels every 20 px) to read card edges off by eye.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const require = createRequire("file:///C:/Users/Chris/cardflip/package.json");
const sharp = require("sharp");
const D = "C:/Users/Chris/cardflip/.outline-dumps/";
const OUT = process.argv[2];
const Z = 3;
for (const stamp of process.argv.slice(3)) {
  const meta = JSON.parse(await readFile(D + stamp + ".json", "utf8"));
  const { sx, sy, sw, sh, w, h } = meta.crop;
  const buf = await sharp(D + stamp + ".jpg").extract({ left: Math.round(sx), top: Math.round(sy), width: Math.round(sw), height: Math.round(sh) }).resize(w * Z, h * Z, { fit: "fill" }).png().toBuffer();
  const lines = [];
  for (let x = 0; x <= w; x += 10) lines.push(`<line x1="${x * Z}" y1="0" x2="${x * Z}" y2="${h * Z}" stroke="${x % 50 === 0 ? "#ff0" : "#fff"}" stroke-opacity="${x % 50 === 0 ? 0.9 : 0.35}" stroke-width="1"/>` + (x % 20 === 0 ? `<text x="${x * Z + 2}" y="12" fill="#ff0" font-size="11" font-family="sans-serif">${x}</text><text x="${x * Z + 2}" y="${h * Z - 4}" fill="#ff0" font-size="11" font-family="sans-serif">${x}</text>` : ""));
  for (let y = 0; y <= h; y += 10) lines.push(`<line x1="0" y1="${y * Z}" x2="${w * Z}" y2="${y * Z}" stroke="${y % 50 === 0 ? "#0ff" : "#fff"}" stroke-opacity="${y % 50 === 0 ? 0.9 : 0.35}" stroke-width="1"/>` + (y % 20 === 0 ? `<text x="2" y="${y * Z - 2}" fill="#0ff" font-size="11" font-family="sans-serif">${y}</text><text x="${w * Z - 24}" y="${y * Z - 2}" fill="#0ff" font-size="11" font-family="sans-serif">${y}</text>` : ""));
  const svg = `<svg width="${w * Z}" height="${h * Z}" xmlns="http://www.w3.org/2000/svg">${lines.join("")}</svg>`;
  await sharp(buf).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(`${OUT}/${stamp.slice(11, 23)}.png`);
  console.log("wrote", stamp.slice(11, 23));
}
