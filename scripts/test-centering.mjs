// Pins the centering check (src/lib/centering.ts): border detection on a
// synthetic yellow-border card, the PSA verdict ladder, and the refusals
// (no border, sideways card, full-art). Run: npm run test:centering
import assert from "node:assert/strict";

const { measureBorders, centeringFromBorders, checkCentering, isYellow } =
  await import(new URL("../src/lib/centering.ts", import.meta.url).href);

/** Draw a card: background, yellow border of given widths, blue body. */
function card({ W = 300, H = 420, pad = 20, left, right, top, bottom, bg = [40, 40, 40], body = [60, 120, 200] }) {
  const data = new Uint8ClampedArray(W * H * 4);
  const x0 = pad, x1 = W - 1 - pad, y0 = pad, y1 = H - 1 - pad;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c = bg;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
        const inBody = x >= x0 + left && x <= x1 - right && y >= y0 + top && y <= y1 - bottom;
        c = inBody ? body : [240, 200, 40];
      }
      const i = (y * W + x) * 4;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

const close = (a, b, tol = 1) => Math.abs(a - b) <= tol;

{
  // Yellow classifier: border yellow yes, sky blue / black / white no.
  assert.equal(isYellow(240, 200, 40), true);
  assert.equal(isYellow(200, 170, 90), true); // dim lighting
  assert.equal(isYellow(60, 120, 200), false);
  assert.equal(isYellow(10, 10, 10), false);
  assert.equal(isYellow(250, 250, 250), false);
}

{
  // Even borders → 50/50, PSA 10.
  const b = measureBorders(card({ left: 16, right: 16, top: 16, bottom: 16 }));
  assert.ok(b, "borders found");
  assert.ok(close(b.left, 16) && close(b.right, 16) && close(b.top, 16) && close(b.bottom, 16), JSON.stringify(b));
  assert.equal(b.clipped, false);
  assert.ok(close(b.outer.x0, 20) && close(b.outer.x1, 279) && close(b.outer.y0, 20) && close(b.outer.y1, 399));
  const c = centeringFromBorders(b);
  assert.equal(c.horizontal, "50/50");
  assert.equal(c.vertical, "50/50");
  assert.equal(c.psaMax, 10);
}

{
  // 22 vs 10 left/right = 69/31 → PSA 7. Top/bottom fine.
  const c = checkCentering(card({ left: 22, right: 10, top: 15, bottom: 17 }));
  assert.ok(c);
  assert.equal(c.horizontal, "69/31");
  assert.equal(c.vertical, "53/47");
  assert.equal(c.psaMax, 7);
  assert.match(c.verdict, /PSA 7/);
}

{
  // Snug crop (card touches every photo edge) still measures, but is flagged.
  const c = checkCentering(card({ pad: 0, left: 18, right: 14, top: 16, bottom: 16 }));
  assert.ok(c);
  assert.equal(c.borders.clipped, true);
  assert.equal(c.horizontal, "56/44");
  assert.equal(c.psaMax, 9);
}

{
  // Verdict ladder from raw widths.
  const v = (l, r) => centeringFromBorders({ left: l, right: r, top: 10, bottom: 10, outer: { x0: 0, x1: 1, y0: 0, y1: 1 }, clipped: false }).psaMax;
  assert.equal(v(55, 45), 10);
  assert.equal(v(56, 44), 9);
  assert.equal(v(60, 40), 9);
  assert.equal(v(65, 35), 8);
  assert.equal(v(70, 30), 7);
  assert.equal(v(80, 20), 6);
  assert.equal(v(81, 19), 0);
}

{
  // Refusals: no yellow at all (full-art / silver border), body-coloured
  // border, sideways card, tiny image.
  assert.equal(checkCentering(card({ left: 16, right: 16, top: 16, bottom: 16, body: [240, 200, 40] })), null, "all yellow");
  const noBorder = card({ left: 0, right: 0, top: 0, bottom: 0 });
  assert.equal(checkCentering(noBorder), null, "no border");
  assert.equal(checkCentering(card({ W: 420, H: 300, left: 16, right: 16, top: 16, bottom: 16 })), null, "sideways");
  assert.equal(checkCentering({ data: new Uint8ClampedArray(20 * 20 * 4), width: 20, height: 20 }), null, "tiny");
}

console.log("test:centering ok");
