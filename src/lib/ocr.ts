import { createWorker, type Worker } from "tesseract.js";
import type { ScanLanguage } from "@/lib/types";

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

/** Words that appear on cards but are never part of a Pokémon's name. */
const NOISE = new Set([
  "basic",
  "stage",
  "stage1",
  "stage2",
  "evolves",
  "from",
  "pokemon",
  "pokémon",
  "trainer",
  "energy",
  "item",
  "supporter",
  "stadium",
  "tool",
  "ability",
  "ancient",
  "future",
  "weakness",
  "resistance",
  "retreat",
  "illus",
  "hp",
  "ex",
  "gx",
  "vmax",
  "vstar",
]);

/** Same idea as NOISE, for the card furniture printed on Japanese cards. */
const JP_NOISE = new Set([
  "たね",
  "たねポケモン",
  "1進化",
  "2進化",
  "どうぐ",
  "グッズ",
  "サポート",
  "スタジアム",
  "エネルギー",
  "ポケモン",
  "トレーナーズ",
  "ワザ",
  "にげる",
  "弱点",
  "抵抗力",
]);

/** Same idea again, for the card furniture printed on Chinese cards. */
const ZH_NOISE = new Set([
  "基本",
  "一階進化",
  "二階進化",
  "道具",
  "訓練家",
  "支援者",
  "競技場",
  "能量",
  "寶可夢",
  "招式",
  "撤退",
  "弱點",
  "抵抗力",
]);

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

function toLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Strip the decoration that surrounds a name on a real card: HP values, stage
 * markers, suffix symbols, and OCR punctuation garbage.
 */
function cleanNameLine(line: string): string {
  return line
    .replace(/\bHP\s*\d+\b/gi, "")
    .replace(/\b\d+\s*HP\b/gi, "")
    .replace(/[^A-Za-z0-9 '’.\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlausibleName(candidate: string): boolean {
  if (candidate.length < 3 || candidate.length > 28) return false;
  if (!/[A-Za-z]{3}/.test(candidate)) return false;

  const words = candidate.toLowerCase().split(" ").filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;

  // A line made up entirely of card furniture is not a name.
  return !words.every((word) => NOISE.has(word));
}

function extractNameCandidates(lines: string[]): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const line of lines) {
    const cleaned = cleanNameLine(line);
    if (!isPlausibleName(cleaned)) continue;

    // "Charizard VMAX" and "Charizard" should both be tried; the API matches
    // the base name more reliably, so also queue the leading word on its own.
    const variants = [cleaned];
    const [first] = cleaned.split(" ");
    if (first && first.length >= 4 && first !== cleaned) variants.push(first);

    for (const variant of variants) {
      const key = variant.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(variant);
    }
  }

  return candidates.slice(0, 6);
}

/**
 * Japanese and Chinese have no spaces between words and a completely
 * different character set, so the Latin word-count heuristics above don't
 * apply — keep hiragana, katakana and CJK ideographs (covers both scripts;
 * kana ranges are simply unused and harmless when cleaning Chinese text),
 * drop everything else (Latin OCR garbage, HP numbers).
 */
function cleanCjkNameLine(line: string): string {
  return line
    .replace(/[^぀-ゟ゠-ヿ一-鿿・]/g, "")
    .trim();
}

function isPlausibleCjkName(candidate: string, noise: Set<string>): boolean {
  if (candidate.length < 2 || candidate.length > 15) return false;
  return !noise.has(candidate);
}

function extractCjkNameCandidates(lines: string[], noise: Set<string>): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const line of lines) {
    const cleaned = cleanCjkNameLine(line);
    if (!isPlausibleCjkName(cleaned, noise)) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    candidates.push(cleaned);
  }

  return candidates.slice(0, 6);
}

/** Collector numbers print as "074/073" — the left half is what we query on. */
function extractCardNumber(lines: string[]): string | null {
  for (const line of lines) {
    const match = line.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
    if (match) return String(Number(match[1]));
  }
  return null;
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
