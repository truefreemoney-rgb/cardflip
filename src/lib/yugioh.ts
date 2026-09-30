/**
 * Yu-Gi-Oh! helpers shared by the server ranker (lib/server/tcgCards.ts) and
 * the scanner page. Client-safe: no DB.
 */

/**
 * Set code without the language letters: "LOB-EN005" and the first print
 * run's "LOB-005" are one card; "SDY-E005" too. A letter may sit before the
 * digits ("MVP1-ENG53", "LDK2-ENK14", "SGX1-ENB01"); tokens print "TKN".
 * Null when the text is not a set code.
 */
export function yugiohKey(number: string): string | null {
  const m = /^([A-Z0-9]{2,6})\s*-\s*(?:EN|E|NA)?([A-Z]?\d{2,4}[A-Z]?|TKN)$/.exec(number.trim().toUpperCase());
  return m ? `${m[1]}-${m[2]}` : null;
}

/** The foil a row sells as: its rarity, plus the tag for the colored / alt-art faces ("Ultra Rare (Purple)"). */
export function foilLabel(card: { rarity?: string | null; variant?: string | null }): string {
  const rarity = card.rarity || "Unknown rarity";
  // Short rarity codes the source tags some rows with say nothing the rarity doesn't.
  const SHORT = ["utr", "pcr", "pur", "cr", "sr", "ur", "se", "secret", "esr", "psr", "gmr", "eur", "scr"];
  const v = (card.variant ?? "").toLowerCase();
  const words = v.replace(/-/g, " ");
  const tag = v && !SHORT.includes(v) && !rarity.toLowerCase().includes(words) ? words : "";
  return tag ? `${rarity} (${tag.replace(/\b\w/g, (c) => c.toUpperCase())})` : rarity;
}

/**
 * "Which foil?" (09-29, Chris: "do what you got to do"): one set code comes
 * in several rarities and a photo cannot always tell them apart (Rarity
 * Collection sets print seven). Returns one card per foil of the picked
 * card's code, the pick first, keeping the pick's 1st Edition / Unlimited
 * side where the candidates have it. Fewer than two = nothing to ask.
 */
export function foilChoices<T extends { id: string; number: string; rarity?: string | null; variant?: string | null }>(pick: T, candidates: T[]): T[] {
  const key = yugiohKey(pick.number);
  if (!key) return [];
  const first = pick.id.endsWith("-1st");
  const byFoil = new Map<string, T>([[foilLabel(pick), pick]]);
  for (const c of candidates) {
    if (yugiohKey(c.number) !== key) continue;
    const label = foilLabel(c);
    const have = byFoil.get(label);
    if (!have) byFoil.set(label, c);
    else if (have !== pick && have.id.endsWith("-1st") !== first && c.id.endsWith("-1st") === first) byFoil.set(label, c);
  }
  return byFoil.size > 1 ? [...byFoil.values()] : [];
}
