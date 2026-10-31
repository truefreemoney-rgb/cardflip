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
  card: VisionCardRead & { switchedFrom?: string | null; secondLook?: string | null; detectedGame?: string | null; patternFirst?: string | null; patternLookBall?: string | null },
  game: GameId,
  timing: { pre: number; ms: number; soft?: [number, number] },
): Record<string, unknown> {
  return {
    game,
    // Blur scores of the photo (attack-text band, number band; lib/server/photoSoftness.ts), when scored.
    ...(timing.soft ? { soft: timing.soft } : {}),
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
    // Pokémon big-print read (10-30): what picks the printing when the number is hidden; measured from here.
    ...(game === "pokemon" && typeof card.hp === "number" ? { hp: card.hp } : {}),
    ...(game === "pokemon" && Array.isArray(card.attackNames) && card.attackNames.length ? { atk: card.attackNames.slice(0, 4) } : {}),
    ...(game === "pokemon" && typeof card.dexNumber === "number" ? { dex: card.dexNumber } : {}),
    ...(game === "pokemon" && card.regulationMark ? { reg: card.regulationMark } : {}),
    // The give-back reads these (10-11): a slab or another game's card is an empty outcome for the seller.
    ...(card.slab ? { slab: true } : {}),
    ...(card.detectedGame ? { seen: card.detectedGame } : {}),
    // Pokémon only: the reverse-holo symbol read (lib/foilPattern.ts picks the priced line from it).
    ...(game === "pokemon" ? { pattern: card.foilPattern ?? null, ball: card.patternBall ?? null } : {}),
    // The focused text-box look, when one ran (vision.ts needsPatternLook): "found", "reverse", "skipped-slow", "failed".
    ...(card.patternLook ? { look: card.patternLook } : {}),
    // 10-22: what the first read said before the look ("reverse", "ball/poke") and the ball the look saw, so a wrong pick is measurable.
    ...(card.patternFirst ? { first: card.patternFirst, lookBall: card.patternLookBall ?? null } : {}),
    // ms spent in the gates before the vision call, and in the call itself.
    pre: timing.pre,
    ms: timing.ms,
  };
}
