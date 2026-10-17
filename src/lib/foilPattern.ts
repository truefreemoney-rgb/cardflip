/**
 * The pattern printing a Pokémon scan preselects (10-17, #11: "they all have
 * different prices, hopefully catch it in the scan too"). Vision reads the
 * reverse-holo symbol (lib/server/vision.ts POKEMON_READ_SCHEMA); this picks
 * the matching price line among the ones the matched card actually has, or
 * null to keep the default pick. Pure and client-safe.
 *
 *  - A named ball the card sells: that one (Prismatic Poké Ball vs Master Ball).
 *  - Any ball or R when the card has exactly ONE theme pattern: that one.
 *    Ascended Heroes prints a single theme ball (Friend, Love, Quick, Dusk,
 *    Poké) or Team Rocket's R per card beside its Energy Symbol reverse, and
 *    the read often names a Friend Ball "poke" (measured 10-17).
 *  - An energy symbol the card sells: Energy Symbol Pattern.
 *  - Anything else, including an unplaced ball on a card with two: null.
 * Measured misses all fell toward the cheaper printing, never a dearer one,
 * so a null here leaves the scan exactly where it was before.
 */

import type { PatternBall, VisionCardRead } from "@/lib/types";

const BALL_VARIANT: Record<PatternBall, string> = {
  poke: "pokeBallPattern",
  master: "masterBallPattern",
  friend: "friendBallPattern",
  love: "loveBallPattern",
  quick: "quickBallPattern",
  dusk: "duskBallPattern",
};
const THEME_VARIANTS = new Set([...Object.values(BALL_VARIANT), "teamRocketPattern"]);

export function patternPrintingFor(
  read: Pick<VisionCardRead, "foilPattern" | "patternBall"> | null | undefined,
  /** Variant keys of the matched card's priced USD rows. */
  variants: readonly string[],
): string | null {
  const pattern = read?.foilPattern;
  if (!pattern) return null;
  const has = new Set(variants);
  if (pattern === "energySymbol") return has.has("energySymbolPattern") ? "energySymbolPattern" : null;
  if (pattern !== "ball" && pattern !== "teamRocket") return null;
  const named = pattern === "teamRocket" ? "teamRocketPattern" : read.patternBall ? BALL_VARIANT[read.patternBall] : null;
  if (named && has.has(named)) return named;
  const themes = variants.filter((v) => THEME_VARIANTS.has(v));
  return themes.length === 1 ? themes[0] : null;
}
