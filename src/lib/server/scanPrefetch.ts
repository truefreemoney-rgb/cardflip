import "server-only";
import { NextRequest } from "next/server";
import { GET as searchCard } from "@/app/api/search-card/route";
import { buildSearchParams, printedKeyFromRead } from "@/lib/searchParams";
import { mtgCuesOf } from "@/lib/mtgCues";
import { UNREADABLE_CONFIDENCE, type GameId, type PokemonCard, type ScanLanguage, type VisionCardRead } from "@/lib/types";

/**
 * One trip (scanner #B, 10-30). After the read, the scan route runs the catalog search the phone would make next,
 * inside the same request, and sends the answer back with the read. On a weak signal (Lucas 10-30: scans lost to
 * timeouts) that is one round trip fewer per card, and the first thing the seller sees is the matched card.
 *
 * No second copy of the matching logic: the search is the search-card route handler itself, called with the
 * phone's own headers (so its per-IP limit counts as if the phone called) and the query string lib/searchParams.ts
 * builds from the read. The phone compares that string with the one it would send and uses the answer only on an
 * exact match; otherwise it fetches as before. Bounded: a slow search never holds the scan response.
 */
export const PREFETCH_BUDGET_MS = 2500;

export interface ScanPrefetch {
  params: string;
  cards: PokemonCard[];
}

/** The same "this read is worth searching" test the scanner applies before its first lookup; anything doubtful = no prefetch. */
function worthSearching(read: VisionCardRead, game: GameId): boolean {
  if (!read.name?.trim()) return false;
  if (typeof read.confidence === "number" && read.confidence < UNREADABLE_CONFIDENCE && read.kind !== "art") return false;
  if (read.slab === true || read.kind === "sealed") return false;
  if (read.detectedGame && read.detectedGame !== game && read.detectedGame !== "other") return false;
  if (game === "mtg" && (read.kind === "token" || read.kind === "art")) return false;
  return true;
}

export async function prefetchMatch(req: Request, read: VisionCardRead, game: GameId, language: ScanLanguage, budgetMs = PREFETCH_BUDGET_MS): Promise<ScanPrefetch | null> {
  try {
    if (!worthSearching(read, game)) return null;
    const printed = printedKeyFromRead(read, game);
    const params = buildSearchParams(read.name, printed, language, undefined, game, read.artStyle ?? null, false, read.firstEdition ?? null, game === "mtg" ? mtgCuesOf(read) : null);
    const url = new URL(`/api/search-card?${params.toString()}`, req.url);
    const inner = new NextRequest(url, { headers: req.headers });
    const res = await Promise.race([
      searchCard(inner),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), budgetMs)),
    ]);
    if (!res || !res.ok) return null;
    const json = (await res.json()) as { cards?: PokemonCard[] };
    if (!Array.isArray(json.cards)) return null;
    return { params: params.toString(), cards: json.cards };
  } catch (err) {
    // The phone simply searches itself, as before.
    console.warn("scan prefetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
