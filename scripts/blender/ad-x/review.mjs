// One review image of the three X ads: a labelled row of stills per ad. node review.mjs "<work dir>" "<out.jpg>"
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const [work, out] = process.argv.slice(2);
const rows = [
  ["A-pull", "A  ·  The Pull  (price shown)"],
  ["B-binder", "B  ·  Binder money  (prices + page total)"],
  ["C-lowball", "C  ·  Don't get lowballed  (the $5 offer vs the real price)"],
];
const T = 300, G = 6, LAB = 44, W = 4 * T + 3 * G;
const parts = [];
let y = 0;
for (const [dir, label] of rows) {
  const d = path.join(work, "frames", dir);
  const stills = fs.readdirSync(d).filter((f) => /^still_\d{4}\.png$/.test(f)).sort().slice(0, 4);
  const svg = `<svg width="${W}" height="${LAB}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="12" y="30" font-family="Segoe UI" font-weight="700" font-size="24" fill="#fff">${label}</text></svg>`;
  parts.push({ input: Buffer.from(svg), left: 0, top: y });
  y += LAB;
  for (const [i, f] of stills.entries()) parts.push({ input: await sharp(path.join(d, f)).resize(T, T).toBuffer(), left: i * (T + G), top: y });
  y += T + G;
}
await sharp({ create: { width: W, height: y - G, channels: 3, background: "#111" } }).composite(parts).jpeg({ quality: 85 }).toFile(out);
console.log("review ->", out);
