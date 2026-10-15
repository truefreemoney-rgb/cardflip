import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const require = createRequire("file:///C:/Users/Chris/cardflip/package.json");
const sharp = require("sharp");
const D = "C:/Users/Chris/cardflip/.outline-dumps/";
const [stamp, x0, y0, x1, y1, out] = process.argv.slice(2);
const meta = JSON.parse(await readFile(D + stamp + ".json", "utf8"));
const { sx, sy, sw, sh, w, h } = meta.crop;
const cropBuf = await sharp(D + stamp + ".jpg").extract({ left: Math.round(sx), top: Math.round(sy), width: Math.round(sw), height: Math.round(sh) }).resize(w, h, { fit: "fill" }).png().toBuffer(); const crop = sharp(cropBuf);
const Z = 10;
const buf = await crop.extract({ left: +x0, top: +y0, width: +x1 - +x0, height: +y1 - +y0 }).resize((+x1 - +x0) * Z, (+y1 - +y0) * Z, { kernel: "nearest" }).png().toBuffer();
// Ruler: a tick + label every 5 crop pixels along the top.
const ticks = [];
for (let x = +x0; x <= +x1; x += 5) ticks.push(`<line x1="${(x - +x0) * Z}" y1="0" x2="${(x - +x0) * Z}" y2="${(x % 10 === 0 ? 18 : 9)}" stroke="#ff0" stroke-width="2"/>` + (x % 10 === 0 ? `<text x="${(x - +x0) * Z + 2}" y="30" fill="#ff0" font-size="16" font-family="sans-serif">${x}</text>` : ""));
for (let y = +y0; y <= +y1; y += 5) ticks.push(`<line x1="0" y1="${(y - +y0) * Z}" x2="${(y % 10 === 0 ? 18 : 9)}" y2="${(y - +y0) * Z}" stroke="#0ff" stroke-width="2"/>` + (y % 10 === 0 ? `<text x="20" y="${(y - +y0) * Z + 5}" fill="#0ff" font-size="16" font-family="sans-serif">${y}</text>` : ""));
const svg = `<svg width="${(+x1 - +x0) * Z}" height="${(+y1 - +y0) * Z}" xmlns="http://www.w3.org/2000/svg">${ticks.join("")}</svg>`;
await sharp(buf).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(out);
console.log("wrote", out);
