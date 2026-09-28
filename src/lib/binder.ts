/**
 * Binder-page scan: one photo of a 9-pocket page (or a spread on the table)
 * becomes one crop per card, and each crop runs through the ordinary
 * single-card scan. Pure math here — no DOM — so the crop rules are
 * testable in node (scripts/test-binder.mjs). The browser side that reads
 * the pixels lives in lib/client/binder.ts.
 */

/** A card's box as fractions of the photo (0–1), from the locate call. */
export interface CardBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A pixel rectangle to crop from the original photo. */
export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Most cards one shot can hold: a spread of two 12-pocket pages. Pages come
 * in 1, 2, 4, 6, 9 and 12 pockets; the model returns one box per card it
 * sees, so any layout below the cap works without a grid assumption.
 */
export const MAX_CARDS_PER_PAGE = 24;

/**
 * Margin around the reported box, as a fraction of the box's own size.
 * Vision boxes land within a few percent of the card; the margin keeps a
 * corner that was clipped by a slightly-tight box, at the cost of a sliver
 * of the neighbouring pocket, which the read ignores.
 */
export const CROP_MARGIN = 0.06;

/** A box narrower/shorter than this share of the photo is noise (a sticker, a dice). */
const MIN_BOX = 0.04;

/** Two boxes overlapping this much are the same card reported twice. */
const DUPLICATE_IOU = 0.5;

function clamp01(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(1, Math.max(0, v));
}

function iou(a: CardBox, b: CardBox): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * The model's raw box list → clean boxes in reading order (rows top to
 * bottom, left to right within a row). Drops malformed, tiny and duplicate
 * boxes and caps the count.
 */
export function cleanBoxes(raw: unknown): CardBox[] {
  if (!Array.isArray(raw)) return [];
  const boxes: CardBox[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const x = clamp01(r.x);
    const y = clamp01(r.y);
    const x1 = clamp01(typeof r.w === "number" ? (r.x as number) + r.w : null);
    const y1 = clamp01(typeof r.h === "number" ? (r.y as number) + r.h : null);
    if (x == null || y == null || x1 == null || y1 == null) continue;
    const box = { x, y, w: x1 - x, h: y1 - y };
    if (box.w < MIN_BOX || box.h < MIN_BOX) continue;
    if (boxes.some((b) => iou(b, box) >= DUPLICATE_IOU)) continue;
    boxes.push(box);
  }
  // Reading order: bucket into rows by centre y (a row = within half a card
  // height of the row's first box), then left to right.
  const sorted = [...boxes].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows: CardBox[][] = [];
  for (const box of sorted) {
    const cy = box.y + box.h / 2;
    const row = rows.find((r) => Math.abs(r[0].y + r[0].h / 2 - cy) < r[0].h / 2);
    if (row) row.push(box);
    else rows.push([box]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x)).slice(0, MAX_CARDS_PER_PAGE);
}

/** One box → the padded, clamped pixel rectangle to crop from a photo. */
export function cropRect(box: CardBox, width: number, height: number, margin = CROP_MARGIN): CropRect {
  const mx = box.w * margin;
  const my = box.h * margin;
  const x0 = Math.max(0, box.x - mx) * width;
  const y0 = Math.max(0, box.y - my) * height;
  const x1 = Math.min(1, box.x + box.w + mx) * width;
  const y1 = Math.min(1, box.y + box.h + my) * height;
  return {
    sx: Math.round(x0),
    sy: Math.round(y0),
    sw: Math.max(1, Math.round(x1 - x0)),
    sh: Math.max(1, Math.round(y1 - y0)),
  };
}
