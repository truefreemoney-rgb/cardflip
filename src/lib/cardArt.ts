/**
 * Stock card art has ONE host, assets.tcgdex.net, and it went dark twice in
 * a day (09-07 ~6:30pm ET for minutes; 09-08 from ~7am ET, every asset 404
 * while their API stayed up). Every card on the site went blank both times.
 *
 * This is the second source: images.pokemontcg.io serves the same cards.
 * Its ids match TCGdex's for most sets (base1-4 → base1/4.png); the sets
 * where they differ are in SET_MAP (built 09-08 by joining both set lists
 * on name and card count — trainer kits and TCG Pocket sets have no
 * pokemontcg.io twin and stay unmapped). Card numbers lose their zero
 * padding ("012" → "12"); lettered numbers (SWSH247, GG01, TG01) pass
 * through. low.webp → N.png, high.webp → N_hires.png.
 *
 * Pure: the image components call fallbackArtUrl(src) when a load fails
 * and swap to it before giving up. scripts/test-card-art.mjs pins it.
 */

const SET_MAP: Record<string, string> = {
  lc: "base6",
  bog: "bp",
  "tk-ex-latia": "tk1a",
  "tk-ex-latio": "tk1b",
  "tk-ex-m": "tk2b",
  "tk-ex-p": "tk2a",
  hgssp: "hsp",
  "2011bw": "mcd11",
  "2012bw": "mcd12",
  "2014xy": "mcd14",
  "2015xy": "mcd15",
  "2016xy": "mcd16",
  "2017sm": "mcd17",
  "sm3.5": "sm35",
  "sm7.5": "sm75",
  "2018sm": "mcd18",
  "2019sm": "mcd19",
  fut2020: "fut20",
  "swsh3.5": "swsh35",
  "2021swsh": "mcd21",
  "swsh4.5": "swsh45",
  "swsh4.5sv": "swsh45sv",
  cel25cc: "cel25c",
  "swsh10.5": "pgo",
  "2022swsh": "mcd22",
  "swsh12.5": "swsh12pt5",
  "swsh12.5gg": "swsh12pt5gg",
  sv01: "sv1",
  sv02: "sv2",
  sv03: "sv3",
  "sv03.5": "sv3pt5",
  sv04: "sv4",
  "sv04.5": "sv4pt5",
  sv05: "sv5",
  sv06: "sv6",
  "sv06.5": "sv6pt5",
  sv07: "sv7",
  sv08: "sv8",
  "sv08.5": "sv8pt5",
  sv09: "sv9",
  "sv10.5b": "zsv10pt5",
  "sv10.5w": "rsv10pt5",
  me01: "me1",
  me02: "me2",
  "me02.5": "me2pt5",
  me03: "me3",
  me04: "me4",
  me05: "me5",
};

const TCGDEX = /^https:\/\/assets\.tcgdex\.net\/[a-z]{2}\/[^/]+\/([^/]+)\/([^/]+)\/(low|high)\.(?:webp|png|jpg)(?:[?#].*)?$/;

/**
 * The pokemontcg.io URL for the same card, or null when `src` is not a
 * TCGdex card image (already a fallback, a seller photo, empty).
 */
export function fallbackArtUrl(src: string): string | null {
  const m = TCGDEX.exec(src);
  if (!m) return null;
  const [, setId, localId, size] = m;
  const set = SET_MAP[setId] ?? setId;
  const number = /^\d+$/.test(localId) ? String(Number(localId)) : localId;
  return `https://images.pokemontcg.io/${set}/${number}${size === "high" ? "_hires" : ""}.png`;
}
