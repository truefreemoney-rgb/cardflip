import type { GameId, VisionCardRead } from "@/lib/types";

/**
 * The compact read stored on the scan_usage row (scanUsage.recordScanUsage),
 * the replay material for a miss. Pure: no db, so it is tested without one
 * (scripts/test-scan-log-read.mjs).
 *
 * B1 10-20: Pokémon pattern prints (Eevee 074 Master Ball) were missing in
 * the scanner and the log could not say why — the foilPattern / patternBall
 * read was never stored, so "vision read none" and "vision read master but
 * the line wasn't priced" looked the same. `pattern` and `ball` are now kept
 * for every Pokémon scan (null = the model read no symbol).
 */
export function scanLogRead(
  card: VisionCardRead & { switchedFrom?: string | null; secondLook?: string | null; detectedGame?: string | null },
  game: GameId,
  timing: { pre: number; ms: number },
): Record<string, unknown> {
  return {
    game,
    ...(card.switchedFrom ? { from: card.switchedFrom } : {}),
    // Stored so the second-look rate can be MEASURED next time, not inferred from token counts.
    ...(card.secondLook ? { second: card.secondLook } : {}),
    name: card.name,
    number: card.cardNumber,
    total: card.setTotal,
    code: card.setCode,
    art: card.artStyle,
    kind: card.kind ?? null,
    conf: card.confidence,
    // The give-back reads these (10-11): a slab or another game's card is an empty outcome for the seller.
    ...(card.slab ? { slab: true } : {}),
    ...(card.detectedGame ? { seen: card.detectedGame } : {}),
    // Pokémon only: the reverse-holo symbol read (lib/foilPattern.ts picks the priced line from it).
    ...(game === "pokemon" ? { pattern: card.foilPattern ?? null, ball: card.patternBall ?? null } : {}),
    // ms spent in the gates before the vision call, and in the call itself.
    pre: timing.pre,
    ms: timing.ms,
  };
}
