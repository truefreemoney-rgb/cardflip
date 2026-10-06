/**
 * The one-line "how much to trust this price" badge (audit G1, 10-06). It says only what we really hold: how many days
 * of recorded price history sit behind the number, and whether the market has stopped updating it (the guard's stale
 * note, lib/priceFlag.ts). It never claims a number of sales or sources: the public price comes from one market
 * (TCGplayer, or Cardmarket converted) and eBay sold comps are only fetched live inside the editor.
 */

export type ConfidenceLevel = "solid" | "fair" | "thin";

export interface PriceConfidence {
  level: ConfidenceLevel;
  text: string;
}

/** 30+ days of history is "Solid", 7 to 29 "Fair", under that (or a price that has stood 45+ days) "Thin". */
export const SOLID_DAYS = 30;
export const FAIR_DAYS = 7;

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** `days` = recorded days of history behind this price; `staleDays` = how long the value has stood, when the guard says 45+. */
export function priceConfidence(days: number, staleDays?: number | null): PriceConfidence {
  const d = Math.max(0, Math.floor(days));
  if (staleDays != null && staleDays > 0) return { level: "thin", text: "Old price · check eBay sold" };
  if (d >= SOLID_DAYS) return { level: "solid", text: `Solid price · ${d} days of data` };
  if (d >= FAIR_DAYS) return { level: "fair", text: `Some data · ${d} days of history` };
  if (d >= 2) return { level: "thin", text: `Thin data · ${plural(d, "day")} · check eBay sold` };
  return { level: "thin", text: "Thin data · check eBay sold" };
}
