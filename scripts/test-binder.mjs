// Binder-page crop math (src/lib/binder.ts): the model's raw box list is
// cleaned (malformed, tiny, duplicate boxes dropped; capped), ordered like a
// page reads, and each box becomes a padded, clamped pixel crop. No API
// call, no DOM. Run: npm run test:binder
import assert from "node:assert/strict";

const { cleanBoxes, cropRect, MAX_CARDS_PER_PAGE, CROP_MARGIN } =
  await import(new URL("../src/lib/binder.ts", import.meta.url).href);

// A 3x3 page reported out of order, with a duplicate and some junk.
const grid = [];
for (const r of [2, 0, 1]) for (const c of [1, 2, 0]) grid.push({ x: 0.05 + c * 0.31, y: 0.04 + r * 0.31, w: 0.27, h: 0.28 });
const raw = [
  ...grid,
  { x: 0.06, y: 0.05, w: 0.26, h: 0.27 }, // the top-left card again
  { x: 0.5, y: 0.5, w: 0.01, h: 0.01 }, // a speck
  { x: "a", y: 0, w: 0.2, h: 0.2 }, // malformed
  null,
  { x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, // runs off the photo → clamped, still a box
];
const boxes = cleanBoxes(raw);
assert.equal(boxes.length, 10, "9 cards + the clamped one, junk dropped");
// Reading order: row 0 left→right first.
assert.deepEqual(boxes.slice(0, 3).map((b) => [b.x.toFixed(2), b.y.toFixed(2)]), [["0.05", "0.04"], ["0.36", "0.04"], ["0.67", "0.04"]]);
assert.deepEqual(boxes.slice(3, 6).map((b) => b.y.toFixed(2)), ["0.35", "0.35", "0.35"]);
const last = boxes[boxes.length - 1];
assert.ok(last.x + last.w <= 1 && last.y + last.h <= 1, "clamped inside the photo");

assert.deepEqual(cleanBoxes("nope"), []);
assert.deepEqual(cleanBoxes([{ x: 0.1, y: 0.1, w: 0.02, h: 0.5 }]), [], "too thin");

// Cap.
const many = Array.from({ length: 30 }, (_, i) => ({ x: (i % 6) * 0.16, y: Math.floor(i / 6) * 0.2, w: 0.14, h: 0.18 }));
assert.equal(cleanBoxes(many).length, MAX_CARDS_PER_PAGE);

// Crop: padded by CROP_MARGIN of the box, clamped to the photo, integer px.
const rect = cropRect({ x: 0.5, y: 0.5, w: 0.2, h: 0.3 }, 1000, 1000);
assert.deepEqual(rect, { sx: 488, sy: 482, sw: 224, sh: 336 });
assert.equal(CROP_MARGIN, 0.06);
const edge = cropRect({ x: 0, y: 0.8, w: 0.3, h: 0.3 }, 800, 600);
assert.equal(edge.sx, 0);
assert.equal(edge.sy + edge.sh, 600, "clamped to the bottom edge");
assert.ok(edge.sw >= 1 && edge.sh >= 1);

console.log("test:binder ok");
