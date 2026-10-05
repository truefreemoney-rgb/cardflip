/**
 * Photo checks for the scanner (Chris 10-04: "improve accuracy due to user
 * error, like how they took the picture, blurry, unfocused"). Pure functions
 * over pixel arrays, so the camera, the tests and the calibration script on
 * real prod photos all run the same code.
 *
 * - frameLight / frameMotion: the live hints under the guide (too dark,
 *   glare, hold still). Advisory only, never a gate: the seller still taps
 *   Capture (no auto-scan, 09-03).
 * - findCardQuad + warpQuad: a card sitting small or crooked in the guide is
 *   found by its four edges and flattened to fill the photo, so the reader
 *   gets more pixels on the collector number. Conservative on purpose: any
 *   doubt (a side not found, a ragged edge, a shape that isn't a card) and
 *   the photo goes as it was taken.
 */

/** A card is 63 x 88 mm. */
export const CARD_ASPECT = 63 / 88;

export interface Point {
  x: number;
  y: number;
}

/** RGBA → 8-bit luma (same weights as lib/sharpness rgbaToGray). */
export function toGray(rgba: ArrayLike<number>, pixels: number): Uint8Array {
  const out = new Uint8Array(pixels);
  for (let i = 0, p = 0; p < pixels; i += 4, p++) out[p] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  return out;
}

export interface Light {
  /** Mean luma 0-255 over the inner part of the guide. */
  luma: number;
  /** Share of inner pixels blown to white on every channel (glare on foil or a sleeve). */
  blown: number;
}

/** Light inside the guide, ignoring an `inset` border (fraction) where the table shows. */
export function frameLight(rgba: ArrayLike<number>, w: number, h: number, inset = 0.08): Light {
  const x0 = Math.floor(w * inset), x1 = Math.ceil(w * (1 - inset));
  const y0 = Math.floor(h * inset), y1 = Math.ceil(h * (1 - inset));
  let sum = 0, blown = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      sum += (r * 299 + g * 587 + b * 114) / 1000;
      if (r >= 248 && g >= 248 && b >= 248) blown++;
      n++;
    }
  }
  return { luma: n ? sum / n : 0, blown: n ? blown / n : 0 };
}

/** Mean absolute difference between two same-size grey frames: the hand moving. */
export function frameMotion(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s / n;
}

export type Hint = "dark" | "glare" | "moving" | "closer";

/** Thresholds, set on the 10-04 calibration over prod phone photos (scripts/calibrate-photo-quality.mjs). */
export const HINTS = {
  darkLuma: 55,
  glareBlown: 0.01,
  moving: 12,
  /** Card quad area under this share of the guide = too far away. */
  closerArea: 0.55,
} as const;

export const HINT_TEXT: Record<Hint, string> = {
  dark: "Too dark. Turn on a light",
  glare: "Glare on the card. Tilt it a little",
  moving: "Hold still",
  closer: "Move closer. Fill the guide",
};

/** The one hint worth saying now, most important first; null = looks fine. */
export function pickHint(light: Light, motion: number | null, quadArea: number | null): Hint | null {
  if (light.luma < HINTS.darkLuma) return "dark";
  if (motion != null && motion > HINTS.moving) return "moving";
  if (light.blown > HINTS.glareBlown) return "glare";
  if (quadArea != null && quadArea < HINTS.closerArea) return "closer";
  return null;
}

/* ---------- card edges ---------- */

function blur3(g: Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += g[yy * w + xx];
          n++;
        }
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

interface Line {
  /** Side lines are fitted as along = a * across + b (x = a*y + b for left/right, y = a*x + b for top/bottom). */
  a: number;
  b: number;
}

/** Least squares with one round of outlier rejection; null when too few points agree. */
function fitLine(pts: Array<[number, number]>, minShare: number, tol: number, total: number): Line | null {
  const fit = (p: Array<[number, number]>): Line | null => {
    const n = p.length;
    if (n < 4) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [u, v] of p) {
      sx += u; sy += v; sxx += u * u; sxy += u * v;
    }
    const d = n * sxx - sx * sx;
    if (Math.abs(d) < 1e-9) return null;
    const a = (n * sxy - sx * sy) / d;
    return { a, b: (sy - a * sx) / n };
  };
  const first = fit(pts);
  if (!first) return null;
  const kept = pts.filter(([u, v]) => Math.abs(first.a * u + first.b - v) <= tol);
  if (kept.length < total * minShare) return null;
  const second = fit(kept);
  if (!second) return null;
  const ragged = kept.filter(([u, v]) => Math.abs(second.a * u + second.b - v) <= tol).length;
  return ragged >= total * minShare ? second : null;
}

export interface Quad {
  /** Top-left, top-right, bottom-right, bottom-left, in the input's pixel space. */
  corners: [Point, Point, Point, Point];
  /** Share of the frame the card covers. */
  area: number;
  /** How far the card is turned, degrees. */
  angle: number;
}

/**
 * The card's four edges in a grey frame of the guide crop. Each side is found
 * by walking in from that edge of the frame along 32 lines and stopping at the
 * first strong change (the table ending and the card starting), then fitting
 * a straight line. Null when any side is unsure or the result is not
 * card-shaped.
 */
export function findCardQuad(gray: Uint8Array, w: number, h: number): Quad | null {
  if (w < 40 || h < 40) return null;
  const g = blur3(gray, w, h);
  const at = (x: number, y: number) => g[y * w + x];
  const SAMPLES = 32;
  const reach = 0.42;
  // A step counts as an edge when it is strong for the frame (not for the
  // line): the card border against a table, not the grain of the table.
  let maxStep = 0;
  for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
    const s = Math.max(Math.abs(at(x + 1, y) - at(x - 1, y)), Math.abs(at(x, y + 1) - at(x, y - 1)));
    if (s > maxStep) maxStep = s;
  }
  const T = Math.max(18, maxStep * 0.3);
  const tol = Math.max(2, Math.min(w, h) * 0.012);

  const side = (dir: "left" | "right" | "top" | "bottom"): Line | null => {
    const pts: Array<[number, number]> = [];
    const vertical = dir === "left" || dir === "right";
    const span = vertical ? h : w;
    const depth = Math.floor((vertical ? w : h) * reach);
    for (let k = 0; k < SAMPLES; k++) {
      const across = Math.round(span * (0.18 + (0.64 * k) / (SAMPLES - 1)));
      for (let d = 2; d < depth; d++) {
        let s: number;
        if (dir === "left") s = Math.abs(at(d + 1, across) - at(d - 1, across));
        else if (dir === "right") s = Math.abs(at(w - d, across) - at(w - d - 2, across));
        else if (dir === "top") s = Math.abs(at(across, d + 1) - at(across, d - 1));
        else s = Math.abs(at(across, h - d) - at(across, h - d - 2));
        if (s >= T) {
          const pos = dir === "left" || dir === "top" ? d : (vertical ? w : h) - 1 - d;
          pts.push([across, pos]);
          break;
        }
      }
    }
    return fitLine(pts, 0.7, tol, SAMPLES);
  };

  const L = side("left"), R = side("right"), Tp = side("top"), B = side("bottom");
  if (!L || !R || !Tp || !B) return null;
  // Intersect x = aV*y + bV with y = aH*x + bH.
  const meet = (v: Line, hz: Line): Point => {
    const y = (hz.a * v.b + hz.b) / (1 - hz.a * v.a);
    return { x: v.a * y + v.b, y };
  };
  const corners: [Point, Point, Point, Point] = [meet(L, Tp), meet(R, Tp), meet(R, B), meet(L, B)];
  for (const c of corners) if (!(c.x > -2 && c.x < w + 2 && c.y > -2 && c.y < h + 2)) return null;
  const area = polygonArea(corners) / (w * h);
  const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
  const wTop = dist(corners[0], corners[1]), wBot = dist(corners[3], corners[2]);
  const hL = dist(corners[0], corners[3]), hR = dist(corners[1], corners[2]);
  const aspect = (wTop + wBot) / (hL + hR);
  // Card-shaped: 63:88 within 9 %, opposite sides close in length (a phone held
  // a little off square, not a trapezoid from a wrong edge), and big enough to
  // be the card rather than a box drawn on it.
  if (Math.abs(aspect / CARD_ASPECT - 1) > 0.09) return null;
  if (Math.min(wTop, wBot) / Math.max(wTop, wBot) < 0.85 || Math.min(hL, hR) / Math.max(hL, hR) < 0.85) return null;
  if (area < 0.3 || area > 1.02) return null;
  const angle = (Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x) * 180) / Math.PI;
  return { corners, area, angle };
}

function polygonArea(p: Point[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Worth flattening: the card is noticeably small in the guide or turned. */
export function shouldStraighten(q: Quad | null): q is Quad {
  return Boolean(q && (q.area < 0.82 || Math.abs(q.angle) > 2.5));
}

/** Corners pushed out from the centre by `by` (fraction), so the warp keeps the card's own edge. */
export function growQuad(c: [Point, Point, Point, Point], by: number): [Point, Point, Point, Point] {
  const cx = (c[0].x + c[1].x + c[2].x + c[3].x) / 4;
  const cy = (c[0].y + c[1].y + c[2].y + c[3].y) / 4;
  return c.map((p) => ({ x: cx + (p.x - cx) * (1 + by), y: cy + (p.y - cy) * (1 + by) })) as [Point, Point, Point, Point];
}

/** 3x3 homography (row-major, h33 = 1) taking the w x h rectangle's corners to `quad`. */
export function rectToQuad(w: number, h: number, quad: [Point, Point, Point, Point]): number[] {
  const src: Point[] = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const A: number[][] = [];
  const bv: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = quad[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    bv.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    bv.push(v);
  }
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [bv[c], bv[p]] = [bv[p], bv[c]];
    for (let r = c + 1; r < 8; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      bv[r] -= f * bv[c];
    }
  }
  const x = new Array<number>(8).fill(0);
  for (let r = 7; r >= 0; r--) {
    let s = bv[r];
    for (let k = r + 1; k < 8; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return [...x, 1];
}

/**
 * Flatten `quad` of the source RGBA image into an outW x outH RGBA image
 * (bilinear). Pixels that fall outside the source are left black.
 */
export function warpQuad(
  src: ArrayLike<number>,
  sw: number,
  sh: number,
  quad: [Point, Point, Point, Point],
  outW: number,
  outH: number,
): Uint8ClampedArray {
  const H = rectToQuad(outW, outH, quad);
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const d = H[6] * x + H[7] * y + 1;
      const u = (H[0] * x + H[1] * y + H[2]) / d;
      const v = (H[3] * x + H[4] * y + H[5]) / d;
      const o = (y * outW + x) * 4;
      if (u < 0 || v < 0 || u > sw - 1 || v > sh - 1) {
        out[o + 3] = 255;
        continue;
      }
      const x0 = Math.floor(u), y0 = Math.floor(v);
      const x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
      const fx = u - x0, fy = v - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
        const bot = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
        out[o + c] = top * (1 - fy) + bot * fy;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}
