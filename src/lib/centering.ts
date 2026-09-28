/**
 * Centering check from the scan photo (09-27, Tier 1 feature #2).
 *
 * Pure math over an RGBA pixel buffer so the same code runs in the browser
 * (canvas ImageData) and in the node test (synthetic buffer). Nothing here
 * touches the DOM.
 *
 * How it works: a standard Pokémon card has a solid yellow border around a
 * non-yellow body. We walk scanlines inward from each edge of the photo,
 * find where the yellow starts (outer card edge) and where it stops (inner
 * edge), and take the median border width per side. Left vs right and top
 * vs bottom then give the centering ratios graders quote (55/45 etc).
 *
 * If a side cannot be measured (full-art, silver border, glare, hand in
 * the frame) we return null and the UI says it could not measure, never a
 * made-up number.
 */

export interface PixelBuffer {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface BorderWidths {
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Outer card edge in pixels of the buffer, for drawing. */
  outer: { x0: number; x1: number; y0: number; y1: number };
  /**
   * True when the card touches an edge of the photo, so part of a border
   * may be cut off and the numbers are only approximate.
   */
  clipped: boolean;
}

export interface Centering {
  /** Border widths in pixels, plus the card's outer box. */
  borders: BorderWidths;
  /** Percent of the horizontal border on the LEFT side, 0..100. */
  leftPct: number;
  /** Percent of the vertical border on the TOP side, 0..100. */
  topPct: number;
  /** Larger-first pair for display, e.g. "55/45". */
  horizontal: string;
  vertical: string;
  /** Worst-side share (max of the four), what the grade is judged on. */
  worstPct: number;
  /** Best PSA grade the centering alone allows. 0 = worse than PSA 6. */
  psaMax: 10 | 9 | 8 | 7 | 6 | 0;
  verdict: string;
}

/** PSA front-centering standards, worst-side share allowed per grade. */
export const PSA_CENTERING: { grade: 10 | 9 | 8 | 7 | 6; max: number }[] = [
  { grade: 10, max: 55 },
  { grade: 9, max: 60 },
  { grade: 8, max: 65 },
  { grade: 7, max: 70 },
  { grade: 6, max: 80 },
];

export function isYellow(r: number, g: number, b: number): boolean {
  // Card-border yellow under phone lighting: strong red+green, weak blue.
  return r > 140 && g > 110 && b < 120 && r - b > 60 && g > r * 0.6;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Walk one line of pixels inward and return [outerEdge, innerEdge] offsets
 * from the start of the walk, or null if no yellow band was found.
 * `at(i)` returns the pixel i steps in from the edge.
 */
function measureLine(
  len: number,
  at: (i: number) => [number, number, number],
  minRun: number,
): [number, number] | null {
  let run = 0;
  let outer = -1;
  // Only look in the outer 40% of the line; a border is never deeper.
  const limit = Math.floor(len * 0.4);
  for (let i = 0; i < limit; i++) {
    const [r, g, b] = at(i);
    const y = isYellow(r, g, b);
    if (outer < 0) {
      run = y ? run + 1 : 0;
      if (run >= minRun) outer = i - minRun + 1;
    } else {
      run = y ? 0 : run + 1;
      if (run >= minRun) return [outer, i - minRun + 1];
    }
  }
  return null;
}

/**
 * Measure the four border widths. Returns null unless all four sides were
 * found on most scanlines and the numbers are plausible for a card.
 */
export interface ScanLines {
  L: number[]; R: number[]; T: number[]; B: number[];
  lx: number[]; rx: number[]; ty: number[]; by: number[];
}

/** Raw per-scanline widths and outer-edge positions, for diagnosis. */
export function scanBorders(img: PixelBuffer): ScanLines {
  const { data, width: W, height: H } = img;
  const px = (x: number, y: number): [number, number, number] => {
    const i = (y * W + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const minRun = Math.max(2, Math.round(Math.min(W, H) / 200));
  const lines = 9;
  const s: ScanLines = { L: [], R: [], T: [], B: [], lx: [], rx: [], ty: [], by: [] };
  for (let k = 0; k < lines; k++) {
    // Scanlines across the middle 40% of each axis avoid corners and text.
    const f = 0.3 + (0.4 * k) / (lines - 1);
    const y = Math.round(H * f);
    const x = Math.round(W * f);
    const l = measureLine(W, (i) => px(i, y), minRun);
    if (l) { s.L.push(l[1] - l[0]); s.lx.push(l[0]); }
    const r = measureLine(W, (i) => px(W - 1 - i, y), minRun);
    if (r) { s.R.push(r[1] - r[0]); s.rx.push(W - 1 - r[0]); }
    const t = measureLine(H, (i) => px(x, i), minRun);
    if (t) { s.T.push(t[1] - t[0]); s.ty.push(t[0]); }
    const b = measureLine(H, (i) => px(x, H - 1 - i), minRun);
    if (b) { s.B.push(b[1] - b[0]); s.by.push(H - 1 - b[0]); }
  }
  return s;
}

const LINES = 9;

export function measureBorders(img: PixelBuffer): BorderWidths | null {
  const { width: W, height: H } = img;
  if (W < 40 || H < 40) return null;
  const { L, R, T, B, lx, rx, ty, by } = scanBorders(img);
  const need = Math.ceil(LINES / 2);
  if (L.length < need || R.length < need || T.length < need || B.length < need) return null;
  // A real border sits at the same place on every scanline. Yellow found
  // inside artwork (full-art cards, silver borders) lands all over the
  // place, so a wide spread of edges or widths means "not a border".
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  const tolX = Math.max(3, W * 0.02);
  const tolY = Math.max(3, H * 0.02);
  if (spread(lx) > tolX || spread(rx) > tolX || spread(ty) > tolY || spread(by) > tolY) return null;
  // Widths: yellow artwork touching the border inflates a few lines, and
  // the median shrugs those off, but most lines must agree with it.
  for (const ws of [L, R, T, B]) {
    const m = median(ws);
    const agree = ws.filter((w) => Math.abs(w - m) <= Math.max(3, m * 0.25)).length;
    if (agree < need) return null;
  }
  const outer = { x0: median(lx), x1: median(rx), y0: median(ty), y1: median(by) };
  const cardW = outer.x1 - outer.x0;
  const cardH = outer.y1 - outer.y0;
  // The card must fill most of the crop and stand upright.
  if (cardW < W * 0.5 || cardH < H * 0.5 || cardH < cardW) return null;
  const widths = { left: median(L), right: median(R), top: median(T), bottom: median(B) };
  // A real border is roughly 2%–12% of the card; anything else is a misread.
  for (const [w, dim] of [
    [widths.left, cardW], [widths.right, cardW], [widths.top, cardH], [widths.bottom, cardH],
  ] as const) {
    if (w < dim * 0.015 || w > dim * 0.15) return null;
  }
  const clipped = outer.x0 <= 0 || outer.y0 <= 0 || outer.x1 >= W - 1 || outer.y1 >= H - 1;
  return { ...widths, outer, clipped };
}

function pair(a: number, b: number): string {
  const hi = Math.round((Math.max(a, b) / (a + b)) * 100);
  return `${hi}/${100 - hi}`;
}

/** Turn border widths into the centering verdict. Pure, no pixels. */
export function centeringFromBorders(borders: BorderWidths): Centering {
  const { left, right, top, bottom } = borders;
  const leftPct = (left / (left + right)) * 100;
  const topPct = (top / (top + bottom)) * 100;
  const worstPct = Math.max(leftPct, 100 - leftPct, topPct, 100 - topPct);
  const worst = Math.round(worstPct);
  const hit = PSA_CENTERING.find((s) => worst <= s.max);
  const psaMax = hit ? hit.grade : 0;
  let verdict: string;
  if (psaMax === 10) verdict = "Centered well enough for a PSA 10";
  else if (psaMax === 9) verdict = "Good. PSA 9 range, just off for a 10";
  else if (psaMax === 8) verdict = "A little off. PSA 8 range";
  else if (psaMax === 7) verdict = "Off-center. PSA 7 range";
  else if (psaMax === 6) verdict = "Well off-center. PSA 6 range";
  else verdict = "Badly off-center";
  return {
    borders,
    leftPct,
    topPct,
    horizontal: pair(left, right),
    vertical: pair(top, bottom),
    worstPct,
    psaMax,
    verdict,
  };
}

export function checkCentering(img: PixelBuffer): Centering | null {
  const borders = measureBorders(img);
  return borders ? centeringFromBorders(borders) : null;
}
