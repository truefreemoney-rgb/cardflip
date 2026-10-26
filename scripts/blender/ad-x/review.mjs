// One review image of the X ads: a labelled row of four stills per ad (spread across the ad's stills).
// node review.mjs "<work dir>" "<out.jpg>" [scene ...]   (default: every scene below that has stills)
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const [work, out, ...only] = process.argv.slice(2);
const LABELS = {
  "A-pull": "A  ·  The Pull  (price shown)",
  "B-binder": "B  ·  Binder money  (prices + page total)",
  "C-lowball": "C  ·  Don't get lowballed  (the $5 offer vs the real price)",
};
const T = 300, G = 6, LAB = 44, W = 4 * T + 3 * G;
const parts = [];
let y = 0;
for (const dir of only.length ? only : Object.keys(LABELS)) {
  const d = path.join(work, "frames", dir);
  const all = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /^still_\d{4}\.png$/.test(f)).sort() : [];
  if (!all.length) continue;
  const stills = all.length <= 4 ? all : [0, Math.round(all.length / 3), Math.round((2 * all.length) / 3), all.length - 1].map((i) => all[i]);
  const svg = `<svg width="${W}" height="${LAB}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="12" y="30" font-family="Segoe UI" font-weight="700" font-size="24" fill="#fff">${LABELS[dir] ?? dir}</text></svg>`;
  parts.push({ input: Buffer.from(svg), left: 0, top: y });
  y += LAB;
  for (const [i, f] of stills.entries()) parts.push({ input: await sharp(path.join(d, f)).resize(T, T).toBuffer(), left: i * (T + G), top: y });
  y += T + G;
}
await sharp({ create: { width: W, height: y - G, channels: 3, background: "#111" } }).composite(parts).jpeg({ quality: 85 }).toFile(out);
console.log("review ->", out);
