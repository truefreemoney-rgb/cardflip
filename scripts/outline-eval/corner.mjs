// Full-res patch of the dumped frame round a point given in CROP pixels (the 224-wide working crop), 160x160, 4x.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const require = createRequire("file:///C:/Users/Chris/cardflip/package.json");
const sharp = require("sharp");
const D = "C:/Users/Chris/cardflip/.outline-dumps/";
const [stamp, cxS, cyS, out] = process.argv.slice(2);
const meta = JSON.parse(await readFile(D + stamp + ".json", "utf8"));
const { sx, sy, sw, sh, w, h } = meta.crop;
const fx = Math.round(sx + (+cxS) * (sw / w)), fy = Math.round(sy + (+cyS) * (sh / h));
const R = 80;
const left = Math.max(0, fx - R), top = Math.max(0, fy - R);
const buf = await sharp(D + stamp + ".jpg").extract({ left, top, width: 2 * R, height: 2 * R }).resize(8 * R, 8 * R, { kernel: "nearest" }).png().toBuffer();
const svg = `<svg width="${8 * R}" height="${8 * R}" xmlns="http://www.w3.org/2000/svg"><line x1="${(fx - left) * 4}" y1="0" x2="${(fx - left) * 4}" y2="${8 * R}" stroke="#0f0" stroke-width="1"/><line x1="0" y1="${(fy - top) * 4}" x2="${8 * R}" y2="${(fy - top) * 4}" stroke="#0f0" stroke-width="1"/><text x="4" y="16" fill="#ff0" font-size="14" font-family="sans-serif">full (${fx},${fy}) = crop (${cxS},${cyS}); 1 crop px = ${(sw / w).toFixed(1)} full px</text></svg>`;
await sharp(buf).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(out);
console.log("wrote", out);
