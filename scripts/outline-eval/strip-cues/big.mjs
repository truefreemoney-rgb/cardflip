// node big.mjs <out.jpg> <stamp8>,<stamp8>,...  -> 3x crops with the phone's box and its corner scores
import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire("file:///C:/Users/Chris/cardflip/package.json");
const sharp = require("sharp");
const DUMPS = "C:/Users/Chris/cardflip/.outline-dumps";
const [out, list] = process.argv.slice(2);
const S = 3;
const all = await readdir(DUMPS);
const tiles = [];
for (const short of list.split(",")) {
  const f = all.find((x) => x.endsWith(".json") && x.includes(short));
  const stamp = f.replace(".json", "");
  const meta = JSON.parse(await readFile(path.join(DUMPS, f), "utf8"));
  const quad = meta.quad?.corners ?? meta.quad;
  const { sx, sy, sw, sh, w, h } = meta.crop;
  const crop = sharp(path.join(DUMPS, `${stamp}.jpg`)).extract({ left: Math.round(sx), top: Math.round(sy), width: Math.round(sw), height: Math.round(sh) }).resize(w * S, h * S, { fit: "fill" });
  const pts = quad.map((p) => `${(p.x * S).toFixed(1)},${(p.y * S).toFixed(1)}`).join(" ");
  const e = meta.expect;
  const guide = e ? `<rect x="${e.x * S}" y="${e.y * S}" width="${e.w * S}" height="${e.h * S}" fill="none" stroke="#a78bfa" stroke-width="2" stroke-dasharray="8 8"/>` : "";
  const dots = quad.map((p, i) => `<circle cx="${p.x * S}" cy="${p.y * S}" r="6" fill="none" stroke="#f43f5e" stroke-width="2"/><text x="${p.x * S + 8}" y="${p.y * S - 8}" fill="#fff" font-size="18" font-family="monospace" stroke="#000" stroke-width="0.5">${i}</text>`).join("");
  const svg = `<svg width="${w * S}" height="${h * S}" xmlns="http://www.w3.org/2000/svg">${guide}<polygon points="${pts}" fill="none" stroke="#f43f5e" stroke-width="3"/>${dots}<rect x="0" y="0" width="${w * S}" height="22" fill="#000a"/><text x="4" y="17" fill="#fff" font-size="16" font-family="monospace">${short} ${(meta.trace?.reason ?? "").slice(0, 44)}</text></svg>`;
  tiles.push(await crop.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer());
}
const meta0 = await sharp(tiles[0]).metadata();
await sharp({ create: { width: meta0.width * tiles.length, height: meta0.height, channels: 3, background: "#222" } })
  .composite(tiles.map((t, i) => ({ input: t, left: i * meta0.width, top: 0 }))).jpeg({ quality: 85 }).toFile(out);
console.log("wrote", out);
