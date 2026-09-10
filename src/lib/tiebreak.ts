/**
 * Near-tie detection for the picture tiebreak (09-10). Client-safe: the
 * scanner page and the panel scripts both ask this before spending a call
 * on /api/vision/tiebreak.
 */

/** Score gap at or under which #1 and #2 count as a tie (both rankers use 1-point tiebreaks). */
export const TIEBREAK_GAP = 1;

/** True when #1 and #2 are close enough that the picture should decide. */
export function isNearTie(cards: Array<{ id: string; rankScore?: number }>): boolean {
  if (cards.length < 2) return false;
  const a = cards[0].rankScore;
  const b = cards[1].rankScore;
  return typeof a === "number" && typeof b === "number" && b - a <= TIEBREAK_GAP && cards[0].id !== cards[1].id;
}
