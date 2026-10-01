/**
 * Near-tie detection for the picture tiebreak (09-10). Client-safe: the
 * scanner page and the panel scripts both ask this before spending a call
 * on /api/vision/tiebreak.
 */

import { ONE_PIECE_PROMO_SET, onePieceKey } from "@/lib/onepiece";

/** Score gap at or under which #1 and #2 count as a tie (both rankers use 1-point tiebreaks). */
export const TIEBREAK_GAP = 1;

/** True when #1 and #2 are close enough that the picture should decide. */
export function isNearTie(cards: Array<{ id: string; rankScore?: number }>): boolean {
  if (cards.length < 2) return false;
  const a = cards[0].rankScore;
  const b = cards[1].rankScore;
  return typeof a === "number" && typeof b === "number" && b - a <= TIEBREAK_GAP && cards[0].id !== cards[1].id;
}

/**
 * The ids the picture tiebreak compares: #1 and #2, and for Yu-Gi-Oh! up to
 * six faces within the gap (one set code in several rarities — the Rarity
 * Collection sets print seven, 09-29 — the
 * ranker lifts them there, tcgCards searchYugioh). The "-1st" twin shares
 * its face with the plain row and is never sent as a separate face.
 * Empty when there is no near-tie.
 */
export function tiebreakIds(cards: Array<{ id: string; rankScore?: number; number?: string; setCode?: string | null }>, game: string): string[] {
  if (!isNearTie(cards)) return [];
  if (game === "onepiece") return onePieceTiebreakIds(cards);
  if (game !== "yugioh") return [cards[0].id, cards[1].id];
  const top = cards[0].rankScore as number;
  const out: string[] = [];
  const faces = new Set<string>();
  for (const c of cards) {
    if (typeof c.rankScore !== "number" || c.rankScore - top > TIEBREAK_GAP) continue;
    const face = c.id.replace(/-1st$/, "");
    if (faces.has(face)) continue;
    faces.add(face);
    out.push(c.id);
    if (out.length === 6) break;
  }
  return out.length >= 2 ? out : [cards[0].id, cards[1].id];
}

/**
 * One Piece (09-30): a misread digit leaves several DIFFERENT cards of one
 * name within the gap (OP10-118, OP13-118, OP11-118 off an "OP10-018" read —
 * tcgCards twoDigitsOff). Send up to four distinct numbers, one face each,
 * so the right card is in front of the picture. Printings of one number
 * (base / parallel) collapse to the first, and fall back to #1 vs #2 when
 * the tie is only between those.
 */
function onePieceTiebreakIds(cards: Array<{ id: string; rankScore?: number; number?: string; setCode?: string | null }>): string[] {
  // Two promo printings of one number (a number that is promo-only): the
  // same art with a different stamp or pack. The picture cannot price that
  // and the seller's tap can ("Which printing is yours?") — no call.
  // (Checked after the walk below: another NUMBER inside the gap is still a
  // question for the picture.)
  const promo = (c: { setCode?: string | null }) => (c.setCode ?? "").toUpperCase() === ONE_PIECE_PROMO_SET;
  const top = cards[0].rankScore as number;
  const out: string[] = [];
  const numbers = new Set<string>();
  for (const c of cards) {
    if (typeof c.rankScore !== "number" || c.rankScore - top > TIEBREAK_GAP) continue;
    const key = onePieceKey(c.number ?? c.id);
    if (numbers.has(key)) continue;
    numbers.add(key);
    out.push(c.id);
    if (out.length === 4) break;
  }
  if (out.length >= 2) return out;
  if (promo(cards[0]) && promo(cards[1])) return [];
  return [cards[0].id, cards[1].id];
}
