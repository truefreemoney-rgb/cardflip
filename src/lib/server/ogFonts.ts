import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Fonts for next/og pictures. Geist is next/og's own default (passing `fonts`
 * replaces it, so it rides along first); Noto Sans Symbols 2 covers the
 * card-name glyphs Geist lacks (◇ Prism Star, ★, ♀ ♂). Without it satori
 * fetches each missing glyph from Google Fonts at render time, and a failed
 * fetch (10-04 1:05 PM, "Jirachi ◇") leaves a blank in the picture.
 * Both files ship with the function via outputFileTracingIncludes.
 */
type OgFont = { name: string; data: ArrayBuffer; weight: 400; style: "normal" };

let cached: Promise<OgFont[]> | undefined;

async function load(file: string): Promise<ArrayBuffer> {
  const buf = await readFile(path.join(process.cwd(), "src/assets/fonts", file));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export function ogFonts(): Promise<OgFont[]> {
  cached ??= Promise.all([load("Geist-Regular.ttf"), load("NotoSansSymbols2-Regular.woff")]).then(([geist, symbols]) => [
    { name: "Geist", data: geist, weight: 400, style: "normal" },
    { name: "Noto Sans Symbols 2", data: symbols, weight: 400, style: "normal" },
  ]);
  cached.catch(() => (cached = undefined));
  return cached;
}
