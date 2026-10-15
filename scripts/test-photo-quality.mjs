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

console.log("card edges near the guide (live outline)");
{
  // A wider frame than the guide, with clutter: a lighter "bezel" band down
  // the left of the frame and a bar across the top, the card near the
  // guide. findCardQuad stops at the bezel for some rows; the near finder
  // must still land on the card.
  const w = 240, h = 335;
  const cardH = h * 0.6, cardW = cardH * pq.CARD_ASPECT;
  const clutter = (g) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < 14; x++) g[y * w + x] = 95;
    for (let y = 0; y < 12; y++) for (let x = 0; x < w; x++) g[y * w + x] = 110;
    return g;
  };
  // Guide = the card grown 8 % (card sits a little small in it).
  const guide = { x: w / 2 - cardW * 0.54, y: h / 2 - cardH * 0.54, w: cardW * 1.08, h: cardH * 1.08 };
  const near = pq.findCardQuadNear(clutter(scene(w, h, cardH, 0)), w, h, guide, 0.1);
  check("card in a cluttered frame is found near the guide", near != null);
  if (near) {
    const expectArea = (cardW * cardH) / (w * h);
    check("its size is the card's", Math.abs(near.area - expectArea) < 0.03, `got ${near.area.toFixed(3)} want ${expectArea.toFixed(3)}`);
    check("it is square", Math.abs(near.angle) < 1.5, `got ${near.angle.toFixed(2)}`);
  }
  const turned = pq.findCardQuadNear(clutter(scene(w, h, cardH, 6)), w, h, guide, 0.1);
  check("a turned card in clutter is found", turned != null && Math.abs(turned.angle - 6) < 1.5, turned ? `angle ${turned.angle.toFixed(2)}` : "null");
  // Card poking out of the guide (guide 7 % smaller than the card): still the border, not the art.
  const small = { x: w / 2 - cardW * 0.465, y: h / 2 - cardH * 0.465, w: cardW * 0.93, h: cardH * 0.93 };
  const poking = pq.findCardQuadNear(clutter(scene(w, h, cardH, 0)), w, h, small, 0.1);
  check("a card poking out of the guide still finds its border", poking != null && Math.abs(poking.area - (cardW * cardH) / (w * h)) < 0.03, poking ? `area ${poking.area.toFixed(3)}` : "null");
  // Real noise (xorshift), not the periodic pattern above: that one has straight stripes in it.
  let seed = 2463534242;
  const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed % 256; };
  const noise = new Uint8Array(w * h).map(() => rnd());
  check("noise finds no card near the guide", pq.findCardQuadNear(noise, w, h, guide, 0.1) == null);
}

console.log("card corners (binder pages)");
{
  // A frame with a card whose corners are rounded (4.5 % of its width, a
  // real card's 3 mm) on a plain grey table, and the same card with sharp
  // corners. Patches round the guide's corners, as CameraCapture cuts them.
  const FW = 480, FH = 560;
  const cardW = 240, cardH = Math.round(cardW / pq.CARD_ASPECT);
  const cx0 = (FW - cardW) / 2 + 9, cy0 = (FH - cardH) / 2 - 7;
  const frame = (rounded) => {
    const g = new Uint8Array(FW * FH);
    const r = cardW * 0.045;
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const u = x - cx0, v = y - cy0;
      let inside = u >= 0 && v >= 0 && u < cardW && v < cardH;
      if (inside && rounded) {
        const dx = Math.max(0, Math.max(r - u, u - (cardW - r))), dy = Math.max(0, Math.max(r - v, v - (cardH - r)));
        if (dx > 0 && dy > 0 && Math.hypot(dx, dy) > r) inside = false;
      }
      g[y * FW + x] = inside ? 200 - ((Math.floor(u / 9) + Math.floor(v / 9)) % 2) * 40 : 70 + ((x * 7 + y * 13) % 5);
    }
    return g;
  };
  const guide = { x: (FW - cardW * 1.06) / 2, y: (FH - cardH * 1.06) / 2, w: cardW * 1.06, h: cardH * 1.06 };
  const patchesOf = (g) => {
    const PATCH = 110, half = guide.w * 0.25, scale = PATCH / (guide.w * 0.5);
    return [[guide.x, guide.y], [guide.x + guide.w, guide.y], [guide.x + guide.w, guide.y + guide.h], [guide.x, guide.y + guide.h]].map(([cx, cy]) => {
      const left = Math.max(0, Math.round(cx - half)), top = Math.max(0, Math.round(cy - half));
      const right = Math.min(FW, Math.round(cx + half)), bottom = Math.min(FH, Math.round(cy + half));
      const pw = Math.round((right - left) * scale), ph = Math.round((bottom - top) * scale);
      const gray = new Uint8Array(pw * ph);
      for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) gray[y * pw + x] = g[Math.min(FH - 1, top + Math.floor(y / scale)) * FW + Math.min(FW - 1, left + Math.floor(x / scale))];
      return { gray, pw, ph, ox: left, oy: top, scale };
    });
  };
  const rounded = pq.pickCardCorners(pq.cardCornerCandidates(patchesOf(frame(true)), guide.w, 6), 20, FW, FH);
  check("a card with rounded corners is found from its corners", rounded != null);
  if (rounded) {
    const want = [[cx0, cy0], [cx0 + cardW, cy0], [cx0 + cardW, cy0 + cardH], [cx0, cy0 + cardH]];
    const off = Math.max(...rounded.quad.corners.map((p, i) => Math.hypot(p.x - want[i][0], p.y - want[i][1])));
    check("each corner within 2 % of the card's width", off <= cardW * 0.02, `worst ${off.toFixed(1)} px`);
    check("it is square", Math.abs(rounded.quad.angle) < 1.5, `got ${rounded.quad.angle.toFixed(2)}`);
  }
  const sharp = pq.pickCardCorners(pq.cardCornerCandidates(patchesOf(frame(false)), guide.w, 6), 20, FW, FH);
  // The template's margin, measured 10-15: a sharp corner scores about 60 % of a rounded one.
  check("a box with sharp corners scores under three quarters of the rounded card", !sharp || sharp.score < (rounded?.score ?? Infinity) * 0.75, sharp ? `sharp ${sharp.score.toFixed(0)} vs rounded ${rounded?.score.toFixed(0)}` : "");
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
