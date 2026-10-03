"use client";

/**
 * The feel of a scan: a haptic tap on capture, a pattern on a match (longer
 * for a big one), a short one on a miss — on phones that support
 * navigator.vibrate (Android; iOS Safari ignores it). The synthesised shutter
 * tick and chimes, and the HUD's sound toggle, were removed 10-02 (Chris: "we
 * dont need audio for the scanner"). revealTier stays: the chip's border,
 * stamp and strike still size the moment to the card's value.
 */

function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported (iOS) — silent no-op.
  }
}

/** Shutter: one short tap. */
export function fxCapture(): void {
  buzz(25);
}

export type RevealTier = "plain" | "nice" | "big" | "grail";

/** Match: a two-beat pattern; longer for a big one or a grail. */
export function fxMatch(tier: RevealTier): void {
  buzz(tier === "plain" ? [15, 40, 25] : tier === "nice" ? [20, 40, 40] : [30, 40, 30, 40, 60]);
}

/** No match: a short double tap. */
export function fxMiss(): void {
  buzz([40, 30, 40]);
}

/**
 * How big a moment this is, from the market price. Thresholds are the
 * emotional ones, not statistical: $20 is "worth listing", $100 is "oh
 * nice", $500 is "hold on".
 */
export function revealTier(market: number | null): RevealTier {
  if (market == null || market < 20) return "plain";
  if (market < 100) return "nice";
  if (market < 500) return "big";
  return "grail";
}
