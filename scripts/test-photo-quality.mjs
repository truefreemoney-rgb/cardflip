/**
 * Pins lib/photoQuality.ts: the live-hint rules, the card-edge finder on
 * synthetic photos (a turned card on a table is found, a card filling the
 * frame or plain noise is left alone) and the flattening warp.
 * Run: npm run test:photoquality
 */
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const pq = await import(at("lib/photoQuality.ts"));

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures++;
}

// A table (dark, a little grain) with a card (light border, textured inside) turned by `deg`.
function scene(w, h, cardH, deg, { fill = false } = {}) {
  const g = new Uint8Array(w * h);
  const cw = cardH * pq.CARD_ASPECT;
  const cx = w / 2, cy = h / 2, t = (deg * Math.PI) / 180;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // Into the card's own frame.
    const dx = x - cx, dy = y - cy;
    const u = dx * Math.cos(t) + dy * Math.sin(t), v = -dx * Math.sin(t) + dy * Math.cos(t);
    const inside = fill || (Math.abs(u) < cw / 2 && Math.abs(v) < cardH / 2);
    if (!inside) g[y * w + x] = 40 + ((x * 7 + y * 13) % 9);
    else {
      const border = Math.abs(u) > cw / 2 - cw * 0.06 || Math.abs(v) > cardH / 2 - cardH * 0.05;
      g[y * w + x] = border ? 215 : 120 + ((Math.floor(u / 6) + Math.floor(v / 6)) % 2) * 60;
    }
  }
  return g;
}

console.log("hints");
check("dark frame says dark", pq.pickHint({ luma: 30, blown: 0 }, 0, null) === "dark");
check("glare says glare", pq.pickHint({ luma: 140, blown: 0.03 }, 0, null) === "glare");
check("clean photos stay quiet (prod max 0.1% blown)", pq.pickHint({ luma: 140, blown: 0.001 }, 1, 0.9) === null);
check("moving beats glare", pq.pickHint({ luma: 140, blown: 0.03 }, 20, null) === "moving");
check("small card says move closer", pq.pickHint({ luma: 140, blown: 0 }, 0, 0.4) === "closer");
check("unknown size never says closer", pq.pickHint({ luma: 140, blown: 0 }, 0, null) === null);
const rgba = new Uint8Array(10 * 10 * 4).fill(255);
check("all-white frame is all blown", pq.frameLight(rgba, 10, 10).blown === 1);
check("motion of identical frames is 0", pq.frameMotion(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])) === 0);

console.log("card edges");
{
  const w = 240, h = 335;
  const q = pq.findCardQuad(scene(w, h, h * 0.75, 7), w, h);
  check("turned card on a table is found", q != null);
  if (q) {
    check("angle is about 7 degrees", Math.abs(q.angle - 7) < 1.5, `got ${q.angle.toFixed(2)}`);
    check("area is about 56%", Math.abs(q.area - 0.5625) < 0.06, `got ${q.area.toFixed(3)}`);
    check("worth straightening", pq.shouldStraighten(q));
  }
  const straight = pq.findCardQuad(scene(w, h, h * 0.7, 0), w, h);
  check("small straight card is found and worth straightening", straight != null && pq.shouldStraighten(straight), JSON.stringify(straight && { a: straight.area, ang: straight.angle }));
  const full = pq.findCardQuad(scene(w, h, h, 0, { fill: true }), w, h);
  check("card filling the frame is left alone", !pq.shouldStraighten(full));
  const noise = new Uint8Array(w * h).map((_, i) => (i * 2654435761) % 251);
  check("noise finds no card", pq.findCardQuad(noise, w, h) == null);
}

console.log("warp");
{
  const w = 20, h = 28;
  const src = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    src[i * 4] = (i * 37) % 256;
    src[i * 4 + 1] = (i * 11) % 256;
    src[i * 4 + 2] = (i * 5) % 256;
    src[i * 4 + 3] = 255;
  }
  const quad = [{ x: 0, y: 0 }, { x: w - 1, y: 0 }, { x: w - 1, y: h - 1 }, { x: 0, y: h - 1 }];
  const out = pq.warpQuad(src, w, h, quad, w - 1, h - 1);
  let worst = 0;
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) worst = Math.max(worst, Math.abs(out[(y * (w - 1) + x) * 4] - src[(y * w + x) * 4]));
  check("identity warp keeps the pixels", worst <= 1, `worst ${worst}`);
  const H = pq.rectToQuad(10, 10, [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }]);
  check("homography maps a corner", Math.abs((H[0] * 10 + H[1] * 10 + H[2]) / (H[6] * 10 + H[7] * 10 + 1) - 15) < 1e-6);
}

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
