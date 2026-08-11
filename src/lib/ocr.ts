import { createWorker, type Worker } from "tesseract.js";
import type { ScanLanguage } from "@/lib/types";
import {
  JP_NOISE,
  ZH_NOISE,
  extractCardNumber,
  extractCjkNameCandidates,
  extractNameCandidates,
  toLines,
} from "@/lib/ocrText";

/**
 * Card OCR.
 *
 * Running Tesseract across a whole card photo performs badly: the art, flavour
 * text and attack boxes all produce noise that drowns out the two things we
 * actually need — the Pokémon name (top band) and the collector number
 * (bottom band). So we crop, enhance and scan those two regions separately.
 */

export type { ScanLanguage };

export interface ScanResult {
  /** Ordered best-guess names, most likely first. */
  nameCandidates: string[];
  /** Collector number, e.g. "74" from "074/073". */
  cardNumber: string | null;
  rawLines: string[];
}

const TESSERACT_LANG: Record<ScanLanguage, string> = {
  en: "eng",
  ja: "jpn",
  zh: "chi_tra",
};

const workers = new Map<ScanLanguage, Promise<Worker>>();

function getWorker(lang: ScanLanguage): Promise<Worker> {
  let promise = workers.get(lang);
  if (!promise) {
    promise = createWorker(TESSERACT_LANG[lang]);
    workers.set(lang, promise);
  }
  return promise;
}

/**
 * Load the OCR model ahead of time. Callers can fire this when the scanner
 * mounts (or when the user switches language) so the first scan doesn't pay
 * the model-download cost.
 */
export function warmUpOcr(lang: ScanLanguage = "en"): void {
  void getWorker(lang);
}

interface Band {
  /** Fractions of the source image height. */
  top: number;
  bottom: number;
  scale: number;
}

const NAME_BAND: Band = { top: 0.02, bottom: 0.22, scale: 3 };
const NUMBER_BAND: Band = { top: 0.86, bottom: 1.0, scale: 3 };

/**
 * Crop a horizontal band, upscale it, and push contrast so the glossy/holo
 * foil backgrounds common on valuable cards stop washing out the glyphs.
 */
function cropAndEnhance(source: ImageBitmap, band: Band): HTMLCanvasElement {
  const sy = Math.floor(source.height * band.top);
  const sh = Math.max(1, Math.floor(source.height * (band.bottom - band.top)));

  const canvas = document.createElement("canvas");
  canvas.width = source.width * band.scale;
  canvas.height = sh * band.scale;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;

  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    source,
    0,
    sy,
    source.width,
    sh,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = frame.data;
  const contrast = 1.7;
  const intercept = 128 * (1 - contrast);

  for (let i = 0; i < data.length; i += 4) {
    const grey =
      0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const value = Math.max(0, Math.min(255, grey * contrast + intercept));
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }

  ctx.putImageData(frame, 0, 0);
  return canvas;
}

export async function scanCard(
  file: File | Blob,
  lang: ScanLanguage = "en",
): Promise<ScanResult> {
  const worker = await getWorker(lang);
  const bitmap = await createImageBitmap(file);

  try {
    const [nameResult, numberResult] = await Promise.all([
      worker.recognize(cropAndEnhance(bitmap, NAME_BAND)),
      worker.recognize(cropAndEnhance(bitmap, NUMBER_BAND)),
    ]);

    const nameLines = toLines(nameResult.data.text);
    const numberLines = toLines(numberResult.data.text);

    let nameCandidates: string[];
    if (lang === "ja") {
      nameCandidates = extractCjkNameCandidates(nameLines, JP_NOISE);
    } else if (lang === "zh") {
      nameCandidates = extractCjkNameCandidates(nameLines, ZH_NOISE);
    } else {
      nameCandidates = extractNameCandidates(nameLines);
    }

    return {
      nameCandidates,
      cardNumber: extractCardNumber(numberLines),
      rawLines: [...nameLines, ...numberLines],
    };
  } finally {
    bitmap.close();
  }
}
