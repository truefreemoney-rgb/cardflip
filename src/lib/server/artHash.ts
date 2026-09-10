import "server-only";
import { db } from "@/lib/db";

/**
 * Art Series identification by picture (09-10, the 98% push). An Art Series
 * card's front is the illustration and nothing else — the name and artist
 * are on the BACK — so no read of the front can name it. What can: a
 * difference hash of the picture against the 2,488 Art Series fronts in the
 * mirror (scripts/sync-mtg-art-hash.mjs fills mtg_cards.art_hash; prod gets
 * it through scripts/push-mtg-cues.mjs).
 *
 * dHash: greyscale, shrink to 9×8, one bit per horizontal neighbour pair
 * (left brighter than right) → 64 bits. Survives resizing, JPEG, mild
 * colour/exposure shifts; a clear, straight-on photo of the card lands
 * within a few bits of the catalog scan. Perspective and heavy glare do not,
 * which is what ART_MATCH_MAX_DISTANCE guards against — past it the match is
 * dropped rather than guessed.
 */

export const ART_HASH_BITS = 64;
/** Hamming distance at or under which a photo counts as the same picture. */
export const ART_MATCH_MAX_DISTANCE = 10;

/** 64-bit difference hash as 16 hex chars. `inset` crops that fraction off every edge first (0 = whole image). */
export async function dHash(image: Buffer, inset = 0): Promise<string> {
  const sharp = (await import("sharp")).default;
  let img = sharp(image).rotate();
  if (inset > 0) {
    const meta = await img.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w && h) {
      const left = Math.round(w * inset);
      const top = Math.round(h * inset);
      img = img.extract({ left, top, width: w - 2 * left, height: h - 2 * top });
    }
  }
  const px = await img.grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = "";
  for (let r = 0; r < 8; r++) {
    let byte = 0;
    for (let c = 0; c < 8; c++) {
      byte = (byte << 1) | (px[r * 9 + c] > px[r * 9 + c + 1] ? 1 : 0);
    }
    bits += byte.toString(16).padStart(2, "0");
  }
  return bits;
}

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < 16; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

interface ArtRow {
  id: string;
  name: string;
  set_code: string;
  collector_number: string;
  art_hash: string;
  type_line: string;
}

/** Which hashed rows a picture may match: Art Series fronts, tokens / emblems, or everything hashed. */
export type PictureKind = "art" | "token" | "all";

let cache: { at: number; rows: ArtRow[] } | null = null;
const CACHE_MS = 10 * 60 * 1000;

async function artRows(): Promise<ArtRow[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  try {
    const rows = (await db
      .prepare("SELECT id, name, set_code, collector_number, art_hash, type_line FROM mtg_cards WHERE art_hash <> ''")
      .all()) as unknown as ArtRow[];
    cache = { at: Date.now(), rows };
    return rows;
  } catch {
    return cache?.rows ?? [];
  }
}

export interface ArtMatch {
  id: string;
  name: string;
  setCode: string;
  number: string;
  distance: number;
}

/**
 * The Art Series card this photo is a picture of, or null. Tries the whole
 * frame and two insets (a phone photo carries table around the card; a
 * catalog scan carries the white border) and keeps the closest.
 */
export async function matchArtSeries(image: Buffer, kind: PictureKind = "art"): Promise<ArtMatch | null> {
  const all = await artRows();
  const rows =
    kind === "all" ? all
    : kind === "token" ? all.filter((r) => /^(token|emblem)/i.test(r.type_line ?? ""))
    : all.filter((r) => /^card(?![a-z])/i.test(r.type_line ?? ""));
  if (rows.length === 0) return null;
  const hashes = await Promise.all([0, 0.05, 0.12].map((inset) => dHash(image, inset)));
  let best: ArtMatch | null = null;
  for (const row of rows) {
    for (const h of hashes) {
      const d = hamming(h, row.art_hash);
      if (!best || d < best.distance) {
        best = { id: row.id, name: row.name, setCode: row.set_code, number: row.collector_number, distance: d };
      }
    }
  }
  return best && best.distance <= ART_MATCH_MAX_DISTANCE ? best : null;
}
