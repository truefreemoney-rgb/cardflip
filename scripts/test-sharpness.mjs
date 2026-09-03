/**
 * Pins the scanner's blur gate: the Laplacian-variance score orders sharp
 * above soft on synthetic text-like images, the threshold sits between
 * them, and the RGBA→grey conversion is the standard luma.
 * Run: npm run test:sharpness
 */
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { laplacianVariance, rgbaToGray, isSharpEnough, SHARPNESS_MIN } = await import(at("lib/sharpness.ts"));

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures++;
}

// A "page of text": black bars on white, 480 wide, like an attack line.
const W = 480, H = 144;
function textImage() {
  const g = new Uint8Array(W * H).fill(235);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inLine = (y % 24) >= 8 && (y % 24) < 18;
      const inGlyph = (x % 9) < 5;
      if (inLine && inGlyph) g[y * W + x] = 20;
    }
  }
  return g;
}
function boxBlur(src, radius) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
      s += src[yy * W + xx]; n++;
    }
    out[y * W + x] = s / n;
  }
  return out;
}

const sharp = textImage();
const soft = boxBlur(sharp, 2);
const mush = boxBlur(boxBlur(soft, 3), 3);
const vs = laplacianVariance(sharp, W, H);
const vsoft = laplacianVariance(soft, W, H);
const vmush = laplacianVariance(mush, W, H);
console.log(`  scores: sharp ${vs.toFixed(0)}, soft ${vsoft.toFixed(0)}, mush ${vmush.toFixed(0)}, threshold ${SHARPNESS_MIN}`);
check("sharp text scores above soft text", vs > vsoft);
check("soft text scores above mush", vsoft > vmush);
check("sharp text passes the gate", isSharpEnough(vs));
check("mush fails the gate", !isSharpEnough(vmush));
check("a flat image scores ~0", laplacianVariance(new Uint8Array(W * H).fill(128), W, H) < 1e-6);
check("tiny images score 0 rather than throwing", laplacianVariance(new Uint8Array(4), 2, 2) === 0);

const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
const grey = rgbaToGray(rgba, 3);
check("luma: white→255, black→0, pure red→~76", grey[0] === 255 && grey[1] === 0 && Math.abs(grey[2] - 76) <= 1, `${Array.from(grey)}`);

if (failures > 0) {
  console.error(`\n${failures} sharpness check(s) failed`);
  process.exit(1);
}
console.log("\nAll sharpness checks passed");
