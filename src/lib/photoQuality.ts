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
 * card-shaped. `minArea` = the smallest share of the frame that counts as the
 * card (0.3 for a guide crop; lower when the frame is wider than the guide,
 * as the live outline's is).
 */
/** Why findCardQuad said no (debug overlays only); filled in when passed. */
export interface QuadTrace {
  reason: string;
  T: number;
  maxStep: number;
  sides: string;
  /** Per side, the lines considered: position, inlier share, strength (findCardQuadNear only). */
  detail?: string;
}

export function findCardQuad(gray: Uint8Array, w: number, h: number, minArea = 0.3, trace?: QuadTrace): Quad | null {
  const fail = (reason: string) => {
    if (trace) trace.reason = reason;
    return null;
  };
  if (w < 40 || h < 40) return fail("tiny frame");
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
  if (trace) {
    trace.T = Math.round(T);
    trace.maxStep = Math.round(maxStep);
    trace.sides = `L${L ? "+" : "-"} R${R ? "+" : "-"} T${Tp ? "+" : "-"} B${B ? "+" : "-"}`;
  }
  return quadFromSides(L, R, Tp, B, w, h, minArea, trace);
}

/** The four side lines → a card quad, or null (with the reason) when they don't make a card. */
/** `evenness` = how close opposite sides must be in length (0.85 for a capture crop; 0.78 for the live outline, where a hand-held phone keystones the card). */
function quadFromSides(
  L: Line | null, R: Line | null, Tp: Line | null, B: Line | null,
  w: number, h: number, minArea: number, trace?: QuadTrace, evenness = 0.85,
): Quad | null {
  const fail = (reason: string) => {
    if (trace) trace.reason = reason;
    return null;
  };
  if (!L || !R || !Tp || !B) return fail("side missing");
  // Intersect x = aV*y + bV with y = aH*x + bH.
  const meet = (v: Line, hz: Line): Point => {
    const y = (hz.a * v.b + hz.b) / (1 - hz.a * v.a);
    return { x: v.a * y + v.b, y };
  };
  const corners: [Point, Point, Point, Point] = [meet(L, Tp), meet(R, Tp), meet(R, B), meet(L, B)];
  for (const c of corners) if (!(c.x > -2 && c.x < w + 2 && c.y > -2 && c.y < h + 2)) return fail("corner off frame");
  const area = polygonArea(corners) / (w * h);
  const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
  const wTop = dist(corners[0], corners[1]), wBot = dist(corners[3], corners[2]);
  const hL = dist(corners[0], corners[3]), hR = dist(corners[1], corners[2]);
  const aspect = (wTop + wBot) / (hL + hR);
  // Card-shaped: 63:88 within 9 %, opposite sides close in length (a phone held
  // a little off square, not a trapezoid from a wrong edge), and big enough to
  // be the card rather than a box drawn on it.
  if (Math.abs(aspect / CARD_ASPECT - 1) > 0.09) return fail(`aspect ${aspect.toFixed(2)}`);
  if (Math.min(wTop, wBot) / Math.max(wTop, wBot) < evenness || Math.min(hL, hR) / Math.max(hL, hR) < evenness) return fail("sides uneven");
  if (area < minArea || area > 1.02) return fail(`area ${area.toFixed(2)}`);
  if (trace) trace.reason = "found";
  const angle = (Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x) * 180) / Math.PI;
  return { corners, area, angle };
}

/** Where the card is expected in the frame (the guide), in the frame's pixels. */
export interface ExpectRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The live outline's edge finder (10-15): the card's four edges in a frame
 * that is wider than the guide, with clutter around the card (a monitor
 * bezel, a browser bar, the edge of a binder). findCardQuad stops at the
 * first strong step walking in from the frame's border, which on a cluttered
 * frame lands on the clutter for some rows and the card for others, so no
 * side ever fits. Here every strong step along each row is kept, straight
 * lines are found among them (two-point trials, then least squares over the
 * agreeing points), and the OUTERMOST strong line near the expected edge
 * wins: the card's border beats the art frame inside it, and a faint bezel
 * further out loses on strength. `expect` = the guide in frame pixels.
 */
export function findCardQuadNear(
  gray: Uint8Array, w: number, h: number, expect: ExpectRect, minArea = 0.3, trace?: QuadTrace,
  /** Last tick's corners (frame pixels): the finder sticks to them, so the outline doesn't flip between near-identical lines. */
  prefer?: [Point, Point, Point, Point] | null,
): Quad | null {
  if (w < 40 || h < 40) {
    if (trace) trace.reason = "tiny frame";
    return null;
  }
  const g = blur3(gray, w, h);
  const at = (x: number, y: number) => g[y * w + x];
  const SAMPLES = 32;
  let maxStep = 0;
  for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
    const s = Math.max(Math.abs(at(x + 1, y) - at(x - 1, y)), Math.abs(at(x, y + 1) - at(x, y - 1)));
    if (s > maxStep) maxStep = s;
  }
  // A lower bar than findCardQuad's 30 %: a dark card edge on a dark table
  // (10-15, Chris's Pikachu VMAX on a monitor: three sides found, the dark
  // top missed) is a faint step next to the card's own bright art, and the
  // straight-line test below is what keeps the grain out, not the bar.
  const T = Math.max(14, maxStep * 0.18);
  const tol = Math.max(2, Math.min(w, h) * 0.012);

  // A candidate edge point: `across` the side, `pos` along it, and how strong the step was.
  type Cand = { across: number; pos: number; s: number };

  // A line one side could be, with how good it looked: the share of sampled
  // rows that sat on it (the real edge of a card scores 0.8-1.0; a line
  // stitched from two different edges scrapes the 0.7 floor), the mean step
  // on it, its tilt, and where it crosses the side's middle.
  type Fit = { line: Line; share: number; strength: number; where: number; tilt: number };

  // Each side's best few lines. The combination step below picks the set
  // that makes a card.
  const side = (dir: "left" | "right" | "top" | "bottom"): Fit[] => {
    const vertical = dir === "left" || dir === "right";
    // Rows (or columns) to sample: the middle 80 % of the guide's extent along the side.
    const a0 = vertical ? expect.y + expect.h * 0.1 : expect.x + expect.w * 0.1;
    const a1 = vertical ? expect.y + expect.h * 0.9 : expect.x + expect.w * 0.9;
    // Where to look along the row: 30 % of the guide outside the expected
    // edge, 35 % inside (a card held off to one side). Deeper inside is the card's art, which is full of
    // straight lines of its own (10-15, Chris's frames: text-box rules and
    // the inner edge of the border were winning).
    const edge = dir === "left" ? expect.x : dir === "right" ? expect.x + expect.w : dir === "top" ? expect.y : expect.y + expect.h;
    const dim = vertical ? expect.w : expect.h;
    const outward = dir === "left" || dir === "top" ? -1 : 1;
    const limit = (vertical ? w : h) - 2;
    const p0 = Math.max(1, Math.floor(edge + (outward < 0 ? -dim * 0.3 : -dim * 0.35)));
    const p1 = Math.min(limit, Math.ceil(edge + (outward < 0 ? dim * 0.35 : dim * 0.3)));
    const rows: Cand[][] = [];
    for (let k = 0; k < SAMPLES; k++) {
      const across = Math.round(a0 + ((a1 - a0) * k) / (SAMPLES - 1));
      if (across < 1 || across > (vertical ? h : w) - 2) continue;
      const cands: Cand[] = [];
      let prev = 0, prev2 = 0;
      let rising = false;
      let stepSum = 0, stepN = 0;
      // Peaks only, and never on the frame's own border: the blur runs
      // short there and reads as a straight "edge" the length of the frame
      // (10-15, Chris's phone: the outline's bottom sat on the picture's
      // bottom, below the card).
      // 4 % of the frame in from its border: the blur runs short there and a
      // patterned table fits straight lines along it.
      const margin = Math.max(3, Math.round((vertical ? w : h) * 0.04));
      // And never at the search band's own ends: on a grainy table the
      // outermost peaks kept per row would all sit on the band's edge and
      // line up into a phantom edge.
      const inner0 = Math.max(margin, p0 + 2), inner1 = Math.min(limit + 1 - margin, p1 - 2);
      for (let p = p0; p <= p1; p++) {
        const s = vertical ? Math.abs(at(p + 1, across) - at(p - 1, across)) : Math.abs(at(across, p + 1) - at(across, p - 1));
        stepSum += s;
        stepN++;
        // Keep the peaks: a step that is strong and stops rising. The peak's
        // place is refined between pixels from its two neighbours (a
        // parabola through three samples), so the line sits on the edge,
        // not a pixel in.
        if (s < prev && rising && prev >= T && p - 1 >= inner0 && p - 1 <= inner1) {
          const denom = prev2 - 2 * prev + s;
          const sub = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (prev2 - s)) / denom)) : 0;
          cands.push({ across, pos: p - 1 + sub, s: prev });
        }
        rising = s >= prev;
        prev2 = prev;
        prev = s;
      }
      // Per row: the eight strongest peaks, plus any that stand out from the
      // row's own grain (1.5x its mean step), so a soft outer border edge
      // next to bright art is never crowded out. Grain throws up many weak
      // peaks, and a line that only agrees with those is not an edge. (An
      // earlier "keep the two outermost" rule lined up along the search
      // band's clip in noise and faked an edge.)
      let keep = cands;
      if (cands.length > 8) {
        const bar = (stepSum / Math.max(1, stepN)) * 1.5;
        const byStrength = [...cands].sort((p, q) => q.s - p.s);
        keep = [...byStrength.slice(0, 8), ...byStrength.slice(8).filter((c) => c.s >= bar).slice(0, 3)];
      }
      rows.push(keep);
    }
    const all = rows.flat();
    if (all.length < 4) return [];
    // Two-point trials between rows well apart; a trial wins its inliers (at
    // most one per row, within `tol`) and must agree with 70 % of the rows
    // (60 % let a monitor bezel stand in for a card bottom that was off the
    // picture, 10-15).
    const need = Math.ceil(rows.length * 0.7);
    const trials: Array<{ a: number; b: number }> = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 8; j < rows.length; j += 4) {
        for (const p of rows[i]) for (const q of rows[j]) {
          const a = (q.pos - p.pos) / (q.across - p.across);
          trials.push({ a, b: p.pos - a * p.across });
        }
      }
    }
    const fits: Fit[] = [];
    const mid = (a0 + a1) / 2;
    for (const t of trials) {
      const inliers: Cand[] = [];
      for (const cands of rows) {
        let best: Cand | null = null;
        for (const c of cands) {
          const d = Math.abs(t.a * c.across + t.b - c.pos);
          if (d <= tol && (!best || d < Math.abs(t.a * best.across + t.b - best.pos))) best = c;
        }
        if (best) inliers.push(best);
      }
      if (inliers.length < need) continue;
      const line = fitLine(inliers.map((c) => [c.across, c.pos] as [number, number]), 0.7, tol, inliers.length);
      if (!line) continue;
      const strength = inliers.reduce((sum, c) => sum + c.s, 0) / inliers.length;
      fits.push({ line, share: inliers.length / rows.length, strength, where: line.a * mid + line.b, tilt: (Math.atan(line.a) * 180) / Math.PI });
    }
    if (!fits.length) return [];
    // One line per position (many trials land on the same edge: keep the
    // one most rows agree with), the best four by agreement, then strength.
    const ranked = fits.sort((p, q) => q.share - p.share || q.strength - p.strength);
    const distinct: Fit[] = [];
    for (const f of ranked) if (!distinct.some((d) => Math.abs(d.where - f.where) <= tol)) distinct.push(f);
    const picked = distinct.slice(0, 4);
    if (trace) {
      trace.detail = `${trace.detail ?? ""}${dir[0].toUpperCase()}[${picked
        .map((f) => `${f.where.toFixed(1)}/${f.share.toFixed(2)}/${f.strength.toFixed(0)}/${f.tilt.toFixed(1)}°`)
        .join(" ")}] `;
    }
    return picked;
  };

  const L = side("left"), R = side("right"), Tp = side("top"), B = side("bottom");
  if (trace) {
    trace.T = Math.round(T);
    trace.maxStep = Math.round(maxStep);
    trace.sides = `L${L.length} R${R.length} T${Tp.length} B${B.length}`;
  }
  if (!L.length || !R.length || !Tp.length || !B.length) {
    if (trace) trace.reason = "side missing";
    return null;
  }
  const want: Point[] = prefer ?? [
    { x: expect.x, y: expect.y },
    { x: expect.x + expect.w, y: expect.y },
    { x: expect.x + expect.w, y: expect.y + expect.h },
    { x: expect.x, y: expect.y + expect.h },
  ];
  // Every combination that makes a card: card-shaped (quadFromSides), not
  // turned past 20°, opposite sides parallel within 12° and neighbours
  // square within 8° (10-15, Chris's frames: a hand-held phone keystones
  // the card so its left and right edges differ by 8°; a line stitched from
  // two different edges tilts far more than that against its neighbours).
  const PARALLEL = 12, SQUARE = 8;
  const found: Array<{ q: Quad; off: number; quality: number }> = [];
  let lastReason = "";
  for (const l of L) for (const r of R) for (const t of Tp) for (const b of B) {
    if (Math.abs(t.tilt - b.tilt) > PARALLEL || Math.abs(l.tilt - r.tilt) > PARALLEL) {
      lastReason = "not parallel";
      continue;
    }
    // A rectangle turned by θ has top tilt θ and left tilt -θ (x = a·y + b).
    if (Math.abs(t.tilt + l.tilt) > SQUARE || Math.abs(b.tilt + r.tilt) > SQUARE) {
      lastReason = "not square";
      continue;
    }
    const q = quadFromSides(l.line, r.line, t.line, b.line, w, h, minArea, trace, 0.78);
    if (!q) {
      if (trace) lastReason = trace.reason;
      continue;
    }
    if (Math.abs(q.angle) > 20) {
      lastReason = `turned ${q.angle.toFixed(0)}`;
      continue;
    }
    found.push({
      q,
      off: q.corners.reduce((sum, c, i) => sum + Math.hypot(c.x - want[i].x, c.y - want[i].y), 0),
      quality: l.share + r.share + t.share + b.share,
    });
  }
  if (!found.length) {
    if (trace) trace.reason = lastReason;
    return null;
  }
  // With last tick's corners to go on, stay near them (a few pixels of
  // drift), so the pick sticks instead of flipping between edges.
  let pool = found;
  if (prefer) {
    const nearest = Math.min(...found.map((f) => f.off));
    pool = found.filter((f) => f.off <= nearest + (expect.w + expect.h) * 0.03);
  }
  // Best agreement first (within 0.3 summed over four sides counts as the
  // same), then nearest the guide (a bezel line past the card is as straight
  // as the card's edge but further from where the user put it), then of the
  // ones about as near the biggest: the outer edge of a border is softer
  // than its inner edge but it is the card.
  const bestQuality = Math.max(...pool.map((f) => f.quality));
  const good = pool.filter((f) => f.quality >= bestQuality - 0.3);
  const nearest = Math.min(...good.map((f) => f.off));
  const best = good.filter((f) => f.off <= nearest + (expect.w + expect.h) * 0.1).sort((p, q) => q.q.area - p.q.area)[0].q;
  if (trace) trace.reason = "found";
  return best;
}

/** A small greyscale patch of the frame round one of the guide's corners, for findCardCorners. */
export interface CornerPatch {
  gray: Uint8Array;
  pw: number;
  ph: number;
  /** The patch's top-left in frame pixels, and patch pixels per frame pixel. */
  ox: number;
  oy: number;
  scale: number;
}

/** One corner as found: where (frame pixels), how card-like it looked, the radius that fitted, and which way its edges step (1 = the card brighter than what is round it, -1 darker, 0 unknown). */
export interface CornerFix {
  x: number;
  y: number;
  score: number;
  r: number;
  sign: number;
}

/**
 * The card's four corners, from four patches round the guide's corners
 * (10-15, Chris's binder frames). A card's corners are rounded, about 3 mm
 * (4.5 % of its width), and on a binder page that is the one thing nothing
 * else has: the pocket seams cross at sharp T-junctions, the pocket's top is
 * open, the highlights on the sleeve have no corners, and the art frame's
 * corners are smaller. Each patch is searched for the best quarter-circle
 * joining two straight edges: strong steps along the arc and along both
 * edges past the tangent points, and none along the straight lines inside
 * the rounding (a sharp corner has them) or past the corner (a seam does).
 * Patch k is corner k: top-left, top-right, bottom-right, bottom-left.
 * `expectWidth` is the card's expected width in frame pixels (the guide's).
 */
export function findCardCorners(patches: [CornerPatch, CornerPatch, CornerPatch, CornerPatch], expectWidth: number): [CornerFix, CornerFix, CornerFix, CornerFix] {
  return cardCornerCandidates(patches, expectWidth, 1).map((c) => c[0] ?? { x: 0, y: 0, score: -Infinity, r: 0, sign: 0 }) as [CornerFix, CornerFix, CornerFix, CornerFix];
}

/** One of the corner template's samples: an offset from the corner point, with the normal pointing into the card. */
interface CornerSample {
  x: number;
  y: number;
  n: Point;
}

/** The corner template for one radius: where to read the steps, as offsets from the corner point. */
interface CornerTemplate {
  r: number;
  /** Along both edges past the tangent points. */
  edges: CornerSample[];
  /** Well along both edges: a card's edge runs the length of the card, a box printed on it stops. */
  far: CornerSample[];
  /** Round the quarter circle. */
  arc: CornerSample[];
  /** Inside the rounding along the straight lines: a sharp corner's edges run here, a card's do not. */
  inside: CornerSample[];
  /** Past the corner along both lines: a seam, a highlight or a bezel runs on, a card stops. */
  past: CornerSample[];
}

/** The template for corner k (0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left) at radius r (patch px). */
function cornerTemplate(k: number, r: number): CornerTemplate {
  // Inward unit vectors per corner: along the top/bottom edge, along the side.
  const dirs: Array<[Point, Point]> = [
    [{ x: 1, y: 0 }, { x: 0, y: 1 }],
    [{ x: -1, y: 0 }, { x: 0, y: 1 }],
    [{ x: -1, y: 0 }, { x: 0, y: -1 }],
    [{ x: 1, y: 0 }, { x: 0, y: -1 }],
  ];
  const [u, v] = dirs[k];
  const edges: CornerSample[] = [], far: CornerSample[] = [], arc: CornerSample[] = [], inside: CornerSample[] = [], past: CornerSample[] = [];
  for (let i = 0; i < 6; i++) {
    const d = r * (1.15 + i * 0.35);
    edges.push({ x: u.x * d, y: u.y * d, n: v }, { x: v.x * d, y: v.y * d, n: u });
    // (10-15, Chris's frames: both bottom corners snapped up to the text box's corners without the far samples.)
    const e = r * (3.3 + i * 0.9);
    far.push({ x: u.x * e, y: u.y * e, n: v }, { x: v.x * e, y: v.y * e, n: u });
    if (i < 4) {
      const e = r * (0.12 + i * 0.2);
      inside.push({ x: u.x * e, y: u.y * e, n: v }, { x: v.x * e, y: v.y * e, n: u });
      const f = r * (0.5 + i * 0.5);
      past.push({ x: -u.x * f, y: -u.y * f, n: v }, { x: -v.x * f, y: -v.y * f, n: u });
    }
  }
  const cx = (u.x + v.x) * r, cy = (u.y + v.y) * r;
  for (let i = 1; i <= 7; i++) {
    const th = (Math.PI / 2) * (i / 8);
    const nx = u.x * Math.cos(th) + v.x * Math.sin(th), ny = u.y * Math.cos(th) + v.y * Math.sin(th);
    arc.push({ x: cx - r * nx, y: cy - r * ny, n: { x: nx, y: ny } });
  }
  return { r, edges, far, arc, inside, past };
}

/** What the corner template read at one spot: the score and the mean signed steps that made it (the offline harness looks at these). */
export interface CornerReading {
  score: number;
  r: number;
  sign: number;
  edge: number;
  arc: number;
  far: number;
  inside: number;
  past: number;
}

/**
 * The template's score at patch pixel (x, y) on the blurred patch `g`, or
 * -Infinity when too few samples fit or the edges and the arc do not step
 * one way. The mean signed step across each sample group is taken (signed,
 * because a card's edge steps the same way all along an edge and round its
 * corner, so the steps add up, while a stitched weld seam or grain cancels
 * out); `out`, when given, receives the parts.
 */
function readCorner(g: Float32Array, pw: number, ph: number, t: CornerTemplate, x: number, y: number, out?: CornerReading): number {
  // The signed step across a point, along `n` (two pixels either side, so a sample a pixel off the edge still reads most of it).
  let s = 0, n = 0;
  const sum = (list: CornerSample[]): void => {
    s = 0;
    n = 0;
    for (const o of list) {
      const px = x + o.x, py = y + o.y;
      const x0 = Math.round(px - 2 * o.n.x), y0 = Math.round(py - 2 * o.n.y), x1 = Math.round(px + 2 * o.n.x), y1 = Math.round(py + 2 * o.n.y);
      if (x0 < 0 || y0 < 0 || x1 < 0 || y1 < 0 || x0 >= pw || x1 >= pw || y0 >= ph || y1 >= ph) continue;
      s += g[y1 * pw + x1] - g[y0 * pw + x0];
      n++;
    }
  };
  sum(t.edges);
  const eS = s, eN = n;
  sum(t.arc);
  const aS = s, aN = n;
  if (eN < 8 || aN < 5) return -Infinity;
  const sign = eS + aS >= 0 ? 1 : -1;
  const eMean = (sign * eS) / eN, aMean = (sign * aS) / aN;
  if (eMean <= 0 || aMean <= 0) return -Infinity;
  sum(t.inside);
  const insideMean = n ? Math.abs(s) / n : 0;
  sum(t.past);
  const pastMean = n ? Math.abs(s) / n : 0;
  // The far edge counts as much as the near one; off the patch it is taken on trust.
  sum(t.far);
  const fMean = n >= 4 ? Math.max(0, (sign * s) / n) : eMean;
  const score = Math.min(eMean, aMean * 1.5) + 0.5 * Math.min(eMean, aMean) + 0.5 * Math.min(eMean, fMean) - insideMean - pastMean;
  if (out) {
    out.score = score;
    out.r = t.r;
    out.sign = sign;
    out.edge = eMean;
    out.arc = aMean;
    out.far = fMean;
    out.inside = insideMean;
    out.past = pastMean;
  }
  return score;
}

/** The radii the template is tried at, as multiples of the expected 3 mm: a sleeve's corners are cut rounder (they fitted 5 mm when offered it, 10-15) and are not wanted. */
const CORNER_RADII = [0.8, 1, 1.25];

/**
 * The best `keep` candidates per corner (strongest first, at least `apart`
 * radii from a stronger one), for pickCardCorners: on a binder page a
 * pocket's corner or a neighbour's can outscore the card's in one patch,
 * but not in all four at card spacing.
 */
export function cardCornerCandidates(patches: [CornerPatch, CornerPatch, CornerPatch, CornerPatch], expectWidth: number, keep = 6, apart = 1): [CornerFix[], CornerFix[], CornerFix[], CornerFix[]] {
  return patches.map((patch, k) => {
    const { gray, pw, ph, ox, oy, scale } = patch;
    const g = blur3(gray, pw, ph);
    const r0 = expectWidth * scale * 0.045;
    // The best score at each pixel over the radii, then the local maxima.
    const bestAt = new Float32Array(pw * ph).fill(-Infinity);
    const radiusAt = new Float32Array(pw * ph);
    const signAt = new Int8Array(pw * ph);
    const reading: CornerReading = { score: 0, r: 0, sign: 0, edge: 0, arc: 0, far: 0, inside: 0, past: 0 };
    for (const rf of CORNER_RADII) {
      const t = cornerTemplate(k, r0 * rf);
      const margin = Math.ceil(t.r) + 3;
      for (let y = margin; y < ph - margin; y++) {
        for (let x = margin; x < pw - margin; x++) {
          const score = readCorner(g, pw, ph, t, x, y, reading);
          if (score > bestAt[y * pw + x]) {
            bestAt[y * pw + x] = score;
            radiusAt[y * pw + x] = t.r;
            signAt[y * pw + x] = reading.sign;
          }
        }
      }
    }
    // Local maxima, strongest first, each at least r0 from a stronger one.
    const peaks: CornerFix[] = [];
    for (let y = 1; y < ph - 1; y++) for (let x = 1; x < pw - 1; x++) {
      const s = bestAt[y * pw + x];
      if (s <= 0) continue;
      let top = true;
      for (let dy = -1; dy <= 1 && top; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && bestAt[(y + dy) * pw + x + dx] > s) { top = false; break; }
      if (top) peaks.push({ x, y, score: s, r: radiusAt[y * pw + x], sign: signAt[y * pw + x] });
    }
    peaks.sort((a, b) => b.score - a.score);
    const kept: CornerFix[] = [];
    for (const p of peaks) {
      if (kept.length >= keep) break;
      if (kept.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < r0 * apart)) continue;
      kept.push(p);
    }
    return kept.map((p) => ({ x: ox + p.x / scale, y: oy + p.y / scale, score: p.score, r: p.r / scale, sign: p.sign }));
  }) as [CornerFix[], CornerFix[], CornerFix[], CornerFix[]];
}

/**
 * For the offline harness: the template's best reading over the radii at
 * frame position (x, y) in patch k, searched within `reach` patch px of it
 * (the label is read off by hand, a pixel or two out). Null when nothing there reads as a corner.
 */
export function cornerReadingAt(patch: CornerPatch, k: number, expectWidth: number, x: number, y: number, reach = 2, where = false): (CornerReading & { x: number; y: number }) | null {
  const { gray, pw, ph, ox, oy, scale } = patch;
  const g = blur3(gray, pw, ph);
  const r0 = expectWidth * scale * 0.045;
  const px = Math.round((x - ox) * scale), py = Math.round((y - oy) * scale);
  let best: (CornerReading & { x: number; y: number }) | null = null;
  const reading: CornerReading = { score: 0, r: 0, sign: 0, edge: 0, arc: 0, far: 0, inside: 0, past: 0 };
  for (const rf of CORNER_RADII) {
    const t = cornerTemplate(k, r0 * rf);
    const margin = Math.ceil(t.r) + 3;
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const qx = px + dx, qy = py + dy;
      if (qx < margin || qy < margin || qx >= pw - margin || qy >= ph - margin) continue;
      const score = readCorner(g, pw, ph, t, qx, qy, reading);
      // The best spot in frame px (`where`), else the reading alone.
      if (score > -Infinity && (!best || score > best.score)) best = { ...reading, x: where ? ox + qx / scale : x, y: where ? oy + qy / scale : y };
    }
  }
  return best;
}

/** The scanner's working crop (grey, w x h) and where it sits in the frame (frame pixels), for the edge check along a box's sides. */
export interface CropGray {
  gray: Uint8Array;
  w: number;
  h: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * How pickCardCorners scores a box. The defaults are the ones measured on
 * Chris's binder frames (scripts/outline-eval/bench.mjs, 10-16); the harness
 * varies them through PickOpts.tune, the scanner never does.
 */
export interface PickTuning {
  /** A corner's score counts up to this: one bright corner (a seam's, 120+) must not carry a box. */
  cap: number;
  /** The signed step (blurred crop grey, 4 px apart) that counts as the card's edge along a side. */
  stepMin: number;
  /** How far either side of a box's side the edge may sit (crop px): a card's edge seen through a sleeve scatters a few px. */
  band: number;
  /** A side with an edge along less than this share of its length throws the box out. */
  sideMin: number;
  /** Penalties, in score points: per 1 % of aspect error, per 1 % uneven (opposite sides), per degree out of parallel, per corner whose edges step the other way from the rest. */
  wAspect: number;
  wEven: number;
  wPar: number;
  wSign: number;
  /** The bonus for sitting where the last box was: this share of the score, times the overlap (IoU) with it. */
  wPrior: number;
  /** Boxes within this share of the best score are alike: the nested rule and the last box decide between them. */
  tie: number;
  /** Of two alike boxes one inside the other: "inner" takes the card inside its pocket, "outer" the other way, "off" leaves it to the score. */
  nested: "inner" | "outer" | "off";
  /** Hard limits a card never passes: aspect error (share), unevenness (share), degrees out of parallel. */
  maxAspect: number;
  maxEven: number;
  maxPar: number;
  /** Tracking: with the last box given, each corner's candidates within this share of the box's width of the last corner make the tracked box... */
  trackReach: number;
  /** ...and a box found afresh only replaces it when its score is this many times the tracked box's. */
  switchRatio: number;
  /** Tracking takes the candidate nearest each last corner first (the box only moves with the card), the best-scoring ones within reach only when those make no box. */
  trackNearest: boolean;
}

export const PICK_TUNING: PickTuning = {
  cap: 60,
  stepMin: 10,
  band: 3,
  sideMin: 0.5,
  wAspect: 1,
  wEven: 1,
  wPar: 2,
  wSign: 0,
  wPrior: 0.15,
  tie: 0.1,
  nested: "inner",
  maxAspect: 0.2,
  maxEven: 0.15,
  maxPar: 8,
  trackReach: 0.08,
  // Never while the track holds: the card's own box is usually the WEAKER
  // one on a binder page (its edge through a sleeve reads 2.5x fainter than
  // the seams and sleeve edges round it, 10-16), so a switch to a "clearly
  // better" box would mostly be a switch off the card. A wrong lock ends
  // when the track is lost (the card leaves the guide) and the outline drops.
  switchRatio: Infinity,
  trackNearest: true,
};

export interface PickOpts {
  /** Last tick's box (frame px): a box that overlaps it earns a bonus, and of alike boxes the nearest wins, so the pick does not flip between near-identical boxes tick to tick. */
  prefer?: [Point, Point, Point, Point] | null;
  /** The working crop: each side of a box must have an edge along it (a box stitched from a card's corner and a pocket's has sides that run through nothing). */
  support?: CropGray | null;
  /** Scoring knobs for the offline harness; see PickTuning. */
  tune?: Partial<PickTuning>;
}

export interface Pick {
  quad: Quad;
  fixes: [CornerFix, CornerFix, CornerFix, CornerFix];
  score: number;
  /** The mean share of the four sides' length with an edge along it (1 when no crop was given). */
  support: number;
  /** True when the box was carried over from last tick's corners (see PickTuning.trackReach), false when found afresh. */
  tracked?: boolean;
}

/** One box pickCardCorners weighed, with everything that went into its score (the offline harness reads these). */
export interface ScoredBox extends Pick {
  /** Each side's share with an edge along it (top, right, bottom, left). */
  sides: [number, number, number, number];
  /** The corners' scores summed, each capped. */
  cornerSum: number;
  aspectErr: number;
  evenErr: number;
  parErr: number;
  /** Corners whose edges step the other way from the rest. */
  odd: number;
  /** The box's bounding box in frame px: left, right, top, bottom. */
  box: [number, number, number, number];
}

const boxOf = (q: Point[]): [number, number, number, number] => {
  let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
  for (const p of q) {
    if (p.x < l) l = p.x;
    if (p.x > r) r = p.x;
    if (p.y < t) t = p.y;
    if (p.y > b) b = p.y;
  }
  return [l, r, t, b];
};
const iouBox = ([l, r, t, b]: [number, number, number, number], [L, R, T, B]: [number, number, number, number]): number => {
  const ix = Math.max(0, Math.min(r, R) - Math.max(l, L)), iy = Math.max(0, Math.min(b, B) - Math.max(t, T));
  const inter = ix * iy;
  const union = (r - l) * (b - t) + (R - L) * (B - T) - inter;
  return union > 0 ? inter / union : 0;
};

/**
 * The share of a side's length (from a to b, crop px, the box clockwise so
 * the card is on the right of the walk) with the card's edge along it: at
 * 24 points between the rounded corners, the signed step across the side
 * (inside minus outside, 4 px apart, the strongest within `band` px of the
 * side) must step the way `sign` says (or, with sign unknown, the way most
 * of the side does) by at least `stepMin`.
 */
function sideSupport(g: Float32Array, w: number, h: number, a: Point, b: Point, sign: number, stepMin: number, band: number): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 8) return 0;
  const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len;
  const nx = -dy, ny = dx;
  const K = 24;
  const steps: number[] = [];
  const offsets = [0, -band / 2, band / 2, -band, band];
  for (let k = 0; k < K; k++) {
    const along = (0.08 + (0.84 * k) / (K - 1)) * len;
    const px = a.x + dx * along, py = a.y + dy * along;
    let best = 0;
    for (const o of offsets) {
      const ix = Math.round(px + nx * (o + 2)), iy = Math.round(py + ny * (o + 2));
      const ox = Math.round(px + nx * (o - 2)), oy = Math.round(py + ny * (o - 2));
      if (ix < 0 || iy < 0 || ox < 0 || oy < 0 || ix >= w || ox >= w || iy >= h || oy >= h) continue;
      const s = g[iy * w + ix] - g[oy * w + ox];
      if (Math.abs(s) > Math.abs(best)) best = s;
    }
    steps.push(best);
  }
  if (!steps.length) return 0;
  const way = sign || (steps.reduce((s, v) => s + v, 0) >= 0 ? 1 : -1);
  return steps.filter((s) => s * way >= stepMin).length / steps.length;
}

/**
 * The card from the corner candidates (10-16, measured on Chris's binder
 * frames with scripts/outline-eval/bench.mjs): every four candidates (or
 * three, with the fourth completed as the parallelogram) that make a box
 * roughly card-shaped is scored, and the best wins.
 *
 * - Corner scores count up to `cap` each: on a binder page a pocket's seam
 *   corner scores 120+ and used to carry a box stitched from it and three
 *   of the card's corners.
 * - With the working crop given, each side must have an edge along at least
 *   `sideMin` of its length, and the score is scaled by the mean share: a
 *   stitched box has sides that cross nothing.
 * - Aspect, unevenness and parallelism are penalties, not just gates, so a
 *   box does not fall in and out of favour as it crosses a threshold from
 *   tick to tick.
 * - With last tick's box given, overlap with it earns a bonus and breaks ties.
 * A three-corner box needs each of its corners to be clearly strong (1.5x
 * `minScore`), a four-corner one each at least `minScore`.
 */
export function pickCardCorners(cands: [CornerFix[], CornerFix[], CornerFix[], CornerFix[]], minScore: number, w: number, h: number, opts: PickOpts = {}): Pick | null {
  const t: PickTuning = { ...PICK_TUNING, ...opts.tune };
  // Every box, scored, only when it is needed: a tracked tick with no switching skips the 10^4 combinations.
  let all: ScoredBox[] | null = null;
  const scoredAll = (): ScoredBox[] => (all ??= scoreCardBoxes(cands, minScore, w, h, opts));
  const prefer = opts.prefer ? boxOf(opts.prefer) : null;
  // Tracking (10-16, measured with scripts/outline-eval/bench.mjs PRIOR=1):
  // the candidates near last tick's corners make a box of their own, and
  // it holds unless a box found afresh clearly beats it. Picked afresh each
  // tick, the box flipped between near-identical boxes as the hand moved a
  // few pixels (the candidate list changes under it); held, it only moves
  // with the card.
  if (opts.prefer && prefer) {
    const reach = (prefer[1] - prefer[0]) * t.trackReach;
    const last = opts.prefer;
    const near = cands.map((list, k) => list.filter((f) => Math.hypot(f.x - last[k].x, f.y - last[k].y) <= reach).sort((p, q) => Math.hypot(p.x - last[k].x, p.y - last[k].y) - Math.hypot(q.x - last[k].x, q.y - last[k].y))) as [CornerFix[], CornerFix[], CornerFix[], CornerFix[]];
    if (near.filter((l) => l.length).length >= 3) {
      let tracked: ScoredBox | undefined;
      if (t.trackNearest) tracked = scoreCardBoxes(near.map((l) => l.slice(0, 1)) as [CornerFix[], CornerFix[], CornerFix[], CornerFix[]], minScore, w, h, opts)[0];
      tracked ??= scoreCardBoxes(near, minScore, w, h, opts)[0];
      if (tracked && !(Number.isFinite(t.switchRatio) && scoredAll().length && scoredAll()[0].score > tracked.score * t.switchRatio)) {
        return { quad: tracked.quad, fixes: tracked.fixes, score: tracked.score, support: tracked.support, tracked: true };
      }
    }
  }
  const scored = scoredAll();
  if (!scored.length) return null;
  const top = scored[0].score;
  let alike = scored.filter((s) => s.score >= top - Math.abs(top) * t.tie);
  if (t.nested !== "off" && alike.length > 1) {
    // Of two alike boxes one inside the other (every corner of the inner
    // within the outer, 2 % of the width of play), keep the one the rule says.
    const inside = (inner: ScoredBox, outer: ScoredBox): boolean => {
      const [l, r, tp, bt] = outer.box;
      const slack = (r - l) * 0.02;
      return inner !== outer && inner.box[0] >= l - slack && inner.box[1] <= r + slack && inner.box[2] >= tp - slack && inner.box[3] <= bt + slack && (inner.box[1] - inner.box[0]) < (r - l);
    };
    alike = alike.filter((s) => !alike.some((o) => (t.nested === "inner" ? inside(o, s) : inside(s, o))));
  }
  let best = alike[0];
  if (prefer && alike.length > 1) {
    let bestIou = -1;
    for (const s of alike) {
      const iou = iouBox(s.box, prefer);
      if (iou > bestIou) {
        bestIou = iou;
        best = s;
      }
    }
  }
  return { quad: best.quad, fixes: best.fixes, score: best.score, support: best.support, tracked: false };
}

/** Every card-shaped box the candidates make, scored as pickCardCorners scores them, best first. */
export function scoreCardBoxes(cands: [CornerFix[], CornerFix[], CornerFix[], CornerFix[]], minScore: number, w: number, h: number, opts: PickOpts = {}): ScoredBox[] {
  const t: PickTuning = { ...PICK_TUNING, ...opts.tune };
  const none: CornerFix = { x: 0, y: 0, score: -Infinity, r: 0, sign: 0 };
  const lists = cands.map((c) => [...c.filter((f) => f.score >= minScore), none]);
  const crop = opts.support ?? null;
  const cg = crop ? blur3(crop.gray, crop.w, crop.h) : null;
  const toCrop = (p: Point): Point => (crop ? { x: ((p.x - crop.sx) / crop.sw) * crop.w, y: ((p.y - crop.sy) / crop.sh) * crop.h } : p);
  const prefer = opts.prefer ? boxOf(opts.prefer) : null;
  // A side's support depends only on its two end points; the same pair comes up in many boxes.
  const sideCache = new Map<string, number>();
  const supportOf = (a: Point, b: Point, sign: number): number => {
    const key = `${a.x.toFixed(1)},${a.y.toFixed(1)}|${b.x.toFixed(1)},${b.y.toFixed(1)}|${sign}`;
    let s = sideCache.get(key);
    if (s === undefined) {
      s = sideSupport(cg as Float32Array, (crop as CropGray).w, (crop as CropGray).h, toCrop(a), toCrop(b), sign, t.stepMin, t.band);
      sideCache.set(key, s);
    }
    return s;
  };
  const scored: ScoredBox[] = [];
  for (const a of lists[0]) for (const b of lists[1]) for (const c of lists[2]) for (const d of lists[3]) {
    const fixes: [CornerFix, CornerFix, CornerFix, CornerFix] = [a, b, c, d];
    const missing = fixes.filter((f) => f === none).length;
    if (missing > 1) continue;
    if (missing === 1 && fixes.some((f) => f !== none && f.score < minScore * 1.5)) continue;
    // One card, one corner radius (within 1.6x): a pocket's corner is rounder.
    const radii = fixes.filter((f) => f !== none).map((f) => f.r);
    if (Math.max(...radii) > Math.min(...radii) * 1.6) continue;
    const geo = boxFromCorners(fixes, minScore, w, h, t.maxAspect, t.maxEven, t.maxPar);
    if (!geo) continue;
    // The way the card's edges step, by majority; corners that step the other way cost `wSign` each.
    let signSum = 0;
    for (const f of fixes) if (f !== none) signSum += f.sign;
    const sign = signSum > 0 ? 1 : signSum < 0 ? -1 : 0;
    let odd = 0;
    for (const f of fixes) if (f !== none && f.sign && f.sign !== sign) odd++;
    let support = 1;
    const sides: [number, number, number, number] = [1, 1, 1, 1];
    if (cg) {
      let sum = 0, bad = false;
      for (let i = 0; i < 4 && !bad; i++) {
        const s = supportOf(geo.quad.corners[i], geo.quad.corners[(i + 1) % 4], sign);
        sides[i] = s;
        if (s < t.sideMin) bad = true;
        sum += s;
      }
      if (bad) continue;
      support = sum / 4;
    }
    let cornerSum = 0;
    for (const f of fixes) if (f !== none) cornerSum += Math.min(f.score, t.cap);
    const base = cornerSum * support * (missing ? 0.85 : 1);
    const penalty = t.wAspect * geo.aspectErr * 100 + t.wEven * geo.evenErr * 100 + t.wPar * geo.parErr + t.wSign * odd;
    const box = boxOf(geo.quad.corners);
    const bonus = prefer ? t.wPrior * base * iouBox(box, prefer) : 0;
    scored.push({ quad: geo.quad, fixes, score: base - penalty + bonus, support, sides, cornerSum, aspectErr: geo.aspectErr, evenErr: geo.evenErr, parErr: geo.parErr, odd, box });
  }
  scored.sort((p, q) => q.score - p.score);
  return scored;
}

/** How a box is carried from tick to tick; see trackCardCorners. */
export interface TrackTuning {
  /** Each corner is looked for within this share of the box's width of where it was: a hand-held phone moves a card 1-3 % a tick, a pocket's corner sits 5-12 % off the card's. */
  reach: number;
  /** A corner that reads below this is lost this tick. */
  floor: number;
  /** A side with an edge along less than this share of its length loses the track (looser than PickTuning.sideMin: the box was good enough to take last tick, and a side that reads 0.5 there reads 0.45 a pixel over). */
  sideMin: number;
}

export const TRACK_TUNING: TrackTuning = { reach: 0.04, floor: 15, sideMin: 0.3 };

/** A box carried over from last tick: the corners as re-found (a lost one scores -Infinity and is completed from the other three), and the edge along each side. */
export interface Track {
  quad: Quad;
  fixes: [CornerFix, CornerFix, CornerFix, CornerFix];
  support: number;
  sides: [number, number, number, number];
}

/**
 * Last tick's box carried to this frame (10-16, Chris's binder frames): each
 * corner is looked for again by the same template within `reach` of where
 * it was, and the peak NEAREST to where it was is the corner: the same
 * feature as last tick, which moves with the card and sits still when the
 * card does. Not the strongest peak in reach: a sleeve or seam corner a few
 * per cent off reads 2-3x stronger than the card's and would take the box
 * (bench 10-16: strongest-in-reach moved the box 3.3 % on the same frame).
 * A peak counts when it reads at least `floor` and, with the corner's last
 * score given, at least half of it: the same corner reads about the same
 * tick to tick, a grain of noise does not. Picked afresh from each tick's
 * candidate list (pickCardCorners with `prefer`), the box swapped between
 * near-identical candidates as the list changed under sensor noise: on the
 * phone it moved 6 % a tick and lost the track on a third of ticks.
 * Patch k must hold corner k's last position with room for the template
 * round it: the scanner centres the patches on the last corners, so the card
 * may sit anywhere, bigger or smaller than the guide. Null when fewer than
 * three corners read as corners, or the box they make is not card-shaped or
 * has a side with no edge along it: the caller picks afresh.
 */
export function trackCardCorners(patches: [CornerPatch, CornerPatch, CornerPatch, CornerPatch], last: [Point, Point, Point, Point], expectWidth: number, w: number, h: number, opts: PickOpts & { track?: Partial<TrackTuning>; lastScores?: number[] | null; /** Why the track was lost (offline harness). */ why?: { reason: string } } = {}): Track | null {
  const tt: TrackTuning = { ...TRACK_TUNING, ...opts.track };
  const t: PickTuning = { ...PICK_TUNING, ...opts.tune };
  const width = Math.hypot(last[1].x - last[0].x, last[1].y - last[0].y);
  const reading: CornerReading = { score: 0, r: 0, sign: 0, edge: 0, arc: 0, far: 0, inside: 0, past: 0 };
  const fixes = patches.map((patch, k) => {
    const { gray, pw, ph, ox, oy, scale } = patch;
    const g = blur3(gray, pw, ph);
    const r0 = expectWidth * scale * 0.045;
    const px = Math.round((last[k].x - ox) * scale), py = Math.round((last[k].y - oy) * scale);
    const R = Math.max(2, Math.round(width * scale * tt.reach));
    // The best reading over the radii at every spot in reach (one ring more, for the peak test).
    const x0 = px - R - 1, y0 = py - R - 1, W = 2 * R + 3;
    const at = new Float32Array(W * W).fill(-Infinity);
    const rAt = new Float32Array(W * W), signAt = new Int8Array(W * W);
    for (const rf of CORNER_RADII) {
      const tpl = cornerTemplate(k, r0 * rf);
      const margin = Math.ceil(tpl.r) + 3;
      for (let y = Math.max(margin, y0); y < Math.min(ph - margin, y0 + W); y++) {
        for (let x = Math.max(margin, x0); x < Math.min(pw - margin, x0 + W); x++) {
          const s = readCorner(g, pw, ph, tpl, x, y, reading);
          const i = (y - y0) * W + (x - x0);
          if (s > at[i]) {
            at[i] = s;
            rAt[i] = tpl.r;
            signAt[i] = reading.sign;
          }
        }
      }
    }
    // The peaks in reach that read enough, strongest first; a peak within
    // 0.6 radii of a stronger one is the same corner read at another radius
    // or a shoulder of its ridge (the three radii fit a corner 2-3 px apart,
    // a plateau makes shoulders) and is dropped.
    const was = opts.lastScores?.[k] ?? 0;
    const need = Math.max(tt.floor, was * 0.5);
    const peaks: Array<{ i: number; j: number; s: number }> = [];
    for (let j = 1; j < W - 1; j++) {
      for (let i = 1; i < W - 1; i++) {
        const s = at[j * W + i];
        if (s < need) continue;
        let peak = true;
        for (let dy = -1; dy <= 1 && peak; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && at[(j + dy) * W + i + dx] > s) { peak = false; break; }
        if (peak) peaks.push({ i, j, s });
      }
    }
    peaks.sort((a, b) => b.s - a.s);
    const kept: typeof peaks = [];
    for (const p of peaks) if (!kept.some((q) => Math.hypot(q.i - p.i, q.j - p.j) < r0 * 0.6)) kept.push(p);
    // The nearest to where the corner was. A corner not seen last tick
    // (completed from the other three, score 0) has no feature to follow:
    // the strongest peak in reach is taken.
    let best: CornerFix = { x: last[k].x, y: last[k].y, score: -Infinity, r: 0, sign: 0 };
    let bestD = Infinity;
    for (const p of kept) {
      const d = was > 0 ? Math.hypot(p.i - R - 1, p.j - R - 1) : -p.s;
      if (d >= bestD) continue;
      bestD = d;
      best = { x: ox + (x0 + p.i) / scale, y: oy + (y0 + p.j) / scale, score: p.s, r: rAt[p.j * W + p.i] / scale, sign: signAt[p.j * W + p.i] };
    }
    return best;
  }) as [CornerFix, CornerFix, CornerFix, CornerFix];
  const lost = (reason: string): null => {
    if (opts.why) opts.why.reason = reason;
    return null;
  };
  const found = fixes.filter((f) => f.score > -Infinity).length;
  if (found < 3) return lost(`corners ${found}`);
  const geo = boxFromCorners(fixes, tt.floor, w, h, t.maxAspect, t.maxEven, t.maxPar);
  if (!geo) return lost("shape");
  let signSum = 0;
  for (const f of fixes) if (f.score > -Infinity) signSum += f.sign;
  const sign = signSum > 0 ? 1 : signSum < 0 ? -1 : 0;
  const sides: [number, number, number, number] = [1, 1, 1, 1];
  let support = 1;
  const crop = opts.support ?? null;
  if (crop) {
    const cg = blur3(crop.gray, crop.w, crop.h);
    const toCrop = (p: Point): Point => ({ x: ((p.x - crop.sx) / crop.sw) * crop.w, y: ((p.y - crop.sy) / crop.sh) * crop.h });
    let sum = 0;
    for (let i = 0; i < 4; i++) {
      const s = sideSupport(cg, crop.w, crop.h, toCrop(geo.quad.corners[i]), toCrop(geo.quad.corners[(i + 1) % 4]), sign, t.stepMin, t.band);
      if (s < tt.sideMin) return lost(`side ${i} ${s.toFixed(2)}`);
      sides[i] = s;
      sum += s;
    }
    support = sum / 4;
  }
  return { quad: geo.quad, fixes, support, sides };
}

/**
 * The card from its four corners (frame pixels): each corner must have
 * scored at least `minScore`, or three must and the fourth is completed as
 * the parallelogram; the box must be card-shaped (63:88 within 9 %),
 * its opposite sides parallel within 8° and even within 22 %. Null otherwise.
 */
export function quadFromCorners(fixes: [CornerFix, CornerFix, CornerFix, CornerFix], minScore: number, w: number, h: number): Quad | null {
  return boxFromCorners(fixes, minScore, w, h, 0.15, 0.1, 5)?.quad ?? null;
}

/**
 * quadFromCorners with the limits as arguments, and how far the box is from
 * a perfect card: aspect error and unevenness as shares, parallelism in
 * degrees (the worst of the two pairs of sides). pickCardCorners turns these
 * into penalties.
 */
function boxFromCorners(fixes: [CornerFix, CornerFix, CornerFix, CornerFix], minScore: number, w: number, h: number, maxAspect: number, maxEven: number, maxPar: number): { quad: Quad; aspectErr: number; evenErr: number; parErr: number } | null {
  const good = fixes.map((f) => f.score >= minScore);
  const n = good.filter(Boolean).length;
  if (n < 3) return null;
  const pts: Point[] = fixes.map((f) => ({ x: f.x, y: f.y }));
  if (n === 3) {
    // The missing corner from the other three: opposite corners of a parallelogram share a midpoint.
    const m = good.indexOf(false);
    const prev = pts[(m + 3) % 4], next = pts[(m + 1) % 4], opp = pts[(m + 2) % 4];
    pts[m] = { x: prev.x + next.x - opp.x, y: prev.y + next.y - opp.y };
  }
  const c = pts as [Point, Point, Point, Point];
  const len = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
  const ang = (a: Point, b: Point) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  // Opposite sides even and parallel: a hand-held phone keystones a card a
  // few per cent; a box stitched from a card's corners and a pocket's is a
  // trapezoid (10-15, Chris's binder frames).
  const top = len(c[0], c[1]), bottom = len(c[3], c[2]), left = len(c[0], c[3]), right = len(c[1], c[2]);
  if (Math.min(top, bottom, left, right) <= 0) return null;
  const evenErr = Math.max(1 - Math.min(top, bottom) / Math.max(top, bottom), 1 - Math.min(left, right) / Math.max(left, right));
  if (evenErr > maxEven) return null;
  // 63:88: a phone held at a slant foreshortens the card to 0.78-0.80 in
  // Chris's binder frames (10-15); a pocket is 0.85-0.95.
  const aspect = (top + bottom) / (left + right);
  const aspectErr = Math.abs(aspect / CARD_ASPECT - 1);
  if (aspectErr > maxAspect) return null;
  const turn = (a: number) => ((a + 180) % 360 + 360) % 360 - 180;
  const parErr = Math.max(Math.abs(turn(ang(c[0], c[1]) - ang(c[3], c[2]))), Math.abs(turn(ang(c[0], c[3]) - ang(c[1], c[2]))));
  if (parErr > maxPar) return null;
  const angle = ang(c[0], c[1]);
  if (Math.abs(angle) > 12) return null;
  return { quad: { corners: c, area: polygonArea(c) / (w * h), angle }, aspectErr, evenErr, parErr };
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
