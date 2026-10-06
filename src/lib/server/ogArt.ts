import "server-only";
import { fallbackArtUrl } from "@/lib/cardArt";

/**
 * Card art as a data URI. Satori draws PNG/JPEG only, so EVERY picture goes
 * through sharp (09-30, all five games): TCGdex serves WebP, Lorcast AVIF
 * (Satori throws on it and the whole picture fails), optcgapi PNG bytes
 * under an image/jpeg header (Satori throws too). Scryfall refuses Node's
 * default User-Agent (400 generic_user_agent), so the fetch names us. When
 * the host or the conversion fails, the pokemontcg.io PNG twin
 * (lib/cardArt.ts) is tried. Empty string = draw the placeholder.
 */
const ART_HEADERS = { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)", Accept: "image/*" };

async function fetchBytes(url: string): Promise<{ bytes: Buffer; type: string } | null> {
  try {
    const res = await fetch(url, { headers: ART_HEADERS, signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (!res.ok) return null;
    return { bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "" };
  } catch {
    return null;
  }
}

/** JPEG at `width` (PNG when the source has alpha, so rounded corners stay clear). */
async function normalise(bytes: Buffer, width: number): Promise<string> {
  const sharp = (await import("sharp")).default;
  const img = sharp(bytes).resize({ width, withoutEnlargement: true });
  if ((await sharp(bytes).metadata()).hasAlpha) return `data:image/png;base64,${(await img.png().toBuffer()).toString("base64")}`;
  return `data:image/jpeg;base64,${(await img.jpeg({ quality: 88 }).toBuffer()).toString("base64")}`;
}

export async function artDataUri(url: string, width = 720): Promise<string> {
  if (!url) return "";
  const primary = await fetchBytes(url);
  if (primary) {
    try {
      return await normalise(primary.bytes, width);
    } catch {
      /* bad bytes: fall through to the PNG twin */
    }
  }
  const twin = fallbackArtUrl(url);
  const fb = twin ? await fetchBytes(twin) : null;
  if (!fb) return "";
  try {
    return await normalise(fb.bytes, width);
  } catch {
    return "";
  }
}

