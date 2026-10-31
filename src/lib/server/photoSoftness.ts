import { laplacianVariance } from "@/lib/sharpness";

/**
 * Server-side blur gate for the scanner, before any paid vision call (10-30).
 *
 * Why here and not only in the camera: the site's gate (components/CameraCapture.tsx) scores the live frame once and
 * lets a second tap within 8 s through, and the app has no gate at all. One account on a Kindle-class camera made 144
 * of the fortnight's 272 Pokémon scans; 134 came back with no collector number at 30-50% confidence even after the
 * second look, so each cost two vision calls and 3-4 s for a "Check match" the seller then fixed by hand or removed.
 *
 * Two bands of the photo the server actually receives, each resampled to 480 px wide and scored by the variance of
 * the Laplacian (lib/sharpness.ts): the attack-text band (big black print) and the number band (the bottom 18%,
 * where every era prints the collector number in small type). A photo is too soft only when BOTH score under
 * SOFT_MAX — the number band alone misfires when the card sits high in the frame and the band is table.
 *
 * Measured on all 78 customer scan photos of 10-16..10-30 (scripts, metadata only, no photo copied): the 34 photos
 * whose read had no number scored 42-194 on the number band and 62-214 on text; every photo from a good camera that
 * read its number scored 229+ on text. Cut 200/200 catches all 34, rejects 5 more from the same camera (40-50%
 * confidence reads), and 0 from any other camera. Chris's own 40 scans: text 669-5756, number 460-4903.
 */
export const SOFT_MAX = 200;

/** The attack-text band (lib/sharpness.ts SHARPNESS_BAND) and the number band, as fractions of the photo. */
const TEXT_BAND = { x: 0.05, y: 0.55, w: 0.9, h: 0.3 } as const;
const NUMBER_BAND = { x: 0, y: 0.82, w: 1, h: 0.18 } as const;
const SAMPLE_WIDTH = 480;

export interface Softness {
  /** Laplacian variance of the attack-text band. */
  text: number;
  /** Laplacian variance of the collector-number band. */
  number: number;
}

/** The message the scanner shows; the seller taps Capture by hand (no auto-scan), so it names that tap. */
export const BLURRY_MESSAGE = "Too blurry to read the card. Hold still, then tap Capture again.";

async function bandScore(input: Buffer, w: number, h: number, band: { x: number; y: number; w: number; h: number }): Promise<number> {
  const sharp = (await import("sharp")).default;
  const left = Math.round(w * band.x);
  const top = Math.round(h * band.y);
  const width = Math.max(3, Math.min(w - left, Math.round(w * band.w)));
  const height = Math.max(3, Math.min(h - top, Math.round(h * band.h)));
  const { data, info } = await sharp(input)
    .extract({ left, top, width, height })
    .resize({ width: SAMPLE_WIDTH })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return laplacianVariance(data, info.width, info.height);
}

/** Both band scores for a photo; null when the picture cannot be decoded (the read then decides, as before). */
export async function photoSoftness(base64Image: string): Promise<Softness | null> {
  try {
    const sharp = (await import("sharp")).default;
    const input = Buffer.from(base64Image, "base64");
    const meta = await sharp(input).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w < 100 || h < 100) return null;
    const [text, number] = await Promise.all([bandScore(input, w, h, TEXT_BAND), bandScore(input, w, h, NUMBER_BAND)]);
    return { text: Math.round(text), number: Math.round(number) };
  } catch (err) {
    console.warn("photo softness: could not score, letting the read decide:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Too soft for the collector number to be read: both bands under SOFT_MAX. */
export function tooSoft(s: Softness | null): boolean {
  return s != null && s.text < SOFT_MAX && s.number < SOFT_MAX;
}
