// Pokémon back: flood-fill the white outside corners to transparent (10-16, Chris).
import sharp from "sharp";
const [src, out] = process.argv.slice(2);
const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;
const idx = (x, y) => (y * w + x) * 4;
const whiteish = (i) => data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200;
const seen = new Uint8Array(w * h);
const stack = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
let cleared = 0;
while (stack.length) {
  const [x, y] = stack.pop();
  if (x < 0 || y < 0 || x >= w || y >= h || seen[y * w + x]) continue;
  seen[y * w + x] = 1;
  const i = idx(x, y);
  if (!whiteish(i)) continue;
  data[i + 3] = 0; cleared++;
  stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
}
// soften the cut: edge pixels next to a cleared one get half alpha
for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
  const i = idx(x, y);
  if (data[i + 3] === 255 && (data[idx(x + 1, y) + 3] === 0 || data[idx(x - 1, y) + 3] === 0 || data[idx(x, y + 1) + 3] === 0 || data[idx(x, y - 1) + 3] === 0)) data[i + 3] = 128;
}
await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toFile(out);
console.log(`${w}x${h}, ${cleared} corner pixels made transparent -> ${out}`);
