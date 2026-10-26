// Contact sheet of a square ad's stills: node sheet.mjs "<frames dir>" "<out.jpg>" [tile px] [columns]
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const [dir, out, tileArg, colsArg] = process.argv.slice(2);
const tile = Number(tileArg ?? 480), files = fs.readdirSync(dir).filter((f) => /^still_\d{4}\.png$/.test(f)).sort();
const cols = Number(colsArg ?? Math.min(files.length, 4)), rows = Math.ceil(files.length / cols), gap = 8;
const tiles = await Promise.all(files.map((f) => sharp(path.join(dir, f)).resize(tile, tile).toBuffer()));
await sharp({ create: { width: cols * tile + (cols - 1) * gap, height: rows * tile + (rows - 1) * gap, channels: 3, background: "#ffffff" } })
  .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * (tile + gap), top: Math.floor(i / cols) * (tile + gap) })))
  .jpeg({ quality: 82 }).toFile(out);
console.log(`${files.length} stills (${files.join(", ")}) -> ${out}`);
