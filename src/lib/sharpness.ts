/**
 * Blur gate for the scanner (Chris, 09-03: the stress test's misreads were
 * soft photos — "could blurry scan images account for some of these
 * issues?" — yes, three of the six).
 *
 * The score is the variance of a 4-neighbour Laplacian over a greyscale
 * image: sharp edges give large second derivatives, blur flattens them.
 * It's scale-dependent, so callers must feed the SAME geometry the
 * threshold was calibrated on: the card's attack-text band (x 5–95 %,
 * y 55–85 % of the guide crop) downscaled to 480 px wide. Text is
 * high-contrast on every card, foil or not, which is why that band
 * separates better than the whole card (holo art scores high even when
 * soft) or the tiny collector-number corner.
 *
 * Calibrated 09-03 on 60 of Chris's stored phone scans: every read the
 * model flagged low-confidence AND misidentified scored under 100 on this
 * band (Buneary 59, Archaludon 91, Sacred Ash 99); the softest CLEAN read
 * scored 110. 90 keeps a margin under that.
 */
export const SHARPNESS_MIN = 90;

/** Width the text band is resampled to before scoring (calibration geometry). */
export const SHARPNESS_SAMPLE_WIDTH = 480;

/** The band of the card the score is taken from, as fractions of the crop. */
export const SHARPNESS_BAND = { x: 0.05, y: 0.55, w: 0.9, h: 0.3 } as const;

/**
 * Variance of the Laplacian over an 8-bit greyscale image (row-major,
 * width*height bytes). Edge pixels are skipped.
 */
export function laplacianVariance(gray: ArrayLike<number>, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const l = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += l;
      sumSq += l * l;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** RGBA pixels (canvas ImageData layout) → 8-bit luma. */
export function rgbaToGray(rgba: ArrayLike<number>, pixels: number): Uint8Array {
  const out = new Uint8Array(pixels);
  for (let i = 0, p = 0; p < pixels; i += 4, p++) {
    out[p] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  }
  return out;
}

export function isSharpEnough(score: number): boolean {
  return score >= SHARPNESS_MIN;
}
