import type { GameId } from "@/lib/types";

/**
 * The nightly eBay referee (10-13): is a $100+ card's market price absurd next
 * to what the same printing is listed for on eBay right now?
 *
 * eBay sold data (Marketplace Insights) is partner-only and was denied, and we
 * never scrape eBay pages, so the only automatic eBay evidence is the Browse
 * API's ACTIVE fixed-price listings. Asks sit at or above what cards sell for,
 * and old cards are listed in every condition, so asks can say "this price is
 * far above anything listed" (a $68,000 Yu-Gi-Oh! ultra rare listed by dozens
 * of sellers at $3) but not "this is 1.8x too high" (that needs sold prices,
 * which the admin hand-check list covers).
 *
 * Pure and network-free: the server job (lib/server/ebayReferee.ts) builds the
 * query, fetches, and stores the reading; priceTrust reads the reading.
 *
 * Calibrated 10-13 on 58 cards whose truth came from eBay sold listings of the
 * exact printing and finish (scripts/test-ebay-referee.mjs pins the cases):
 *  - the cheapest ask is bait: dozens of $2 "Mewtwo Star" listings next to a
 *    $2,500+ card, played copies, fakes. So the rule reads the upper quartile
 *    of the asks that do not say "played", never the cheapest.
 *  - the live comps matcher (ebayComps.ts) is wrong for special printings: it
 *    drops every "Secret Lair" title and ignores foil, so a $4,784 raised-foil
 *    Avatar Aang matched $0.99 regular copies. This matcher requires the
 *    printing's own markers (foil, serialized, raised foil, neon ink, emblem,
 *    reverse holo, 1st Edition, rarity, manga, enchanted, ...).
 */

export const EBAY_REFEREE = {
  /** Printings priced from here up are refereed (the listing-low and graded tiers start here too). */
  minUsd: 100,
  /** High: the price is >= this x the upper quartile of the NM-or-unstated asks ... */
  overUpper: 1.5,
  /** ... with at least this many such asks (2 hid foil Smothering Tithe / Rhystic Study on two asks of another foil treatment, 10-13). */
  minAsks: 3,
  /**
   * A vintage print (set released before vintageBefore) needs this x and vintageMinAsks: old cards are listed in every
   * condition without saying so, so their asks sit far under a Near Mint price (10-13 local run: a $1,300 1st Edition Neo
   * Genesis Lugia against two $430 asks; a $1,050 Mewtwo delta reverse holo that sold for $760-1,000 against asks of $400).
   */
  overUpperVintage: 3,
  vintageMinAsks: 3,
  vintageBefore: "2010-01-01",
  /**
   * High: or >= this x the median of even a single ask (a $213,589 card listed at $1.99; one mispriced $11.99 copy of a $611
   * card is 51x, so not 50). There is no "10x the median" rule: it caught nothing the upper-quartile rule missed, and it hid a
   * $5,500 manga Gol.D.Roger whose own asks reach $7,000 (10-13 local run).
   */
  absurd: 100,
  /** Check (hand-check list, not hidden): >= this x the median ask. */
  overMedian: 1.5,
  /** A reading older than this is no evidence (the rotation re-reads every card within about a week). */
  maxAgeDays: 10,
} as const;

/** One printing as the referee sees it. */
export interface RefereeCard {
  game: GameId;
  cardId: string;
  /** The price series variant: foil / nonfoil / etched (Magic), holofoil / reverseHolofoil / 1stEditionHolofoil / normal (Pokemon), foil / normal (others). */
  variant: string;
  name: string;
  /** Lorcana's second line ("Jungle Ranger"). */
  subtitle?: string;
  /** Collector number; Yu-Gi-Oh!'s and One Piece's is the print code ("GLAS-EN090", "OP16-063"). */
  number: string;
  setName: string;
  setCode?: string;
  /** Pokemon's printed total ("4/102"). */
  setTotal?: number | null;
  rarity?: string;
  /** The set's release date ("YYYY-MM-DD", "" = unknown): before EBAY_REFEREE.vintageBefore the rule is stricter. */
  releaseDate?: string;
  /** tcg_cards.variant: the printing tag (enchanted, manga, utr, chaos-neos-misprint, ...). */
  printing?: string;
  firstEdition?: boolean;
  /** Magic (Scryfall): promo_types, finishes, flavor_name, border_color. */
  promoTypes?: string;
  finishes?: string;
  flavorName?: string;
  borderColor?: string;
}

export interface AskReading {
  /** Matched asks. */
  n: number;
  /** Matched asks that do not say "played" (the NM comparison). */
  nNm: number;
  median: number | null;
  q75: number | null;
  /** The print is vintage (stricter rule, see EBAY_REFEREE.overUpperVintage). */
  vintage?: boolean;
}

export type RefereeVerdict = "high" | "check" | "ok" | "none";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (w: string) => new RegExp(`(^|[^a-z0-9])${esc(w)}([^a-z0-9]|$)`);
const STOP = new Set(["the", "and", "of", "ex", "first", "son"]);
const words = (s: string) =>
  s.toLowerCase().replace(/δ/g, " delta ").replace(/★/g, " ").split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
const frontName = (name: string) => name.split(" // ")[0];

/** Titles that are not one raw, English, undamaged copy. */
const REJECT: RegExp[] = [
  // "PSA9" / "BGS9.5" with no space too (10-14: \b alone let them through).
  /\b(psa|bgs|cgc|sgc|tag|ace|pcg|beckett|becket|ags)(\b|\d)/,
  /graded|pristine|gem mint|black label|slab/,
  /\b(lot|lots|playset|bundle|set of|choose|you pick|pick your)\b/,
  /\bx\s*[2-9]\b|\b[2-9]\s*x\b(?!\d)|\b\d+\s*pieces\b/,
  /signed|altered|autograph|artist proof/,
  /proxy|custom|fake|replica|reprint|orica|art card|art series|insert|token|playtest|fan[\s-]?made|metal|keychain|novelty|unofficial/,
  // 10-18 hand check: $1-30 "Collectable Pokemon ... Secret Rare Rainbow" and "Gold Foil Fan Art" copies of a $250 card.
  /fan[\s-]?art|\bcollectable\b/,
  /read desc|please read|see desc/,
  /japanese|\bjp\b|\bjpn\b|japan|korean|\bkor\b|german|russian|chinese|french|italian|spanish|portuguese/,
  /damaged|\bdmg\b|heavily played|\bhp\b|\bpoor\b|crease|water damage/,
];
/** A played copy: kept out of the NM comparison (a vintage NM copy sells 2-3x a played one). */
const PLAYED = /\b(mp|lp|played|moderate|moderately|light play|lightly|whitening|wear)\b/;

/** Magic set families whose titles rarely carry the set name. */
const MTG_SET_ALIAS: Record<string, RegExp> = {
  pf25: /magicfest|\bmfp\b|commandfest|magiccon/,
  ppro: /pro tour|\bppro\b|\bptp\b/,
  pcmp: /\bchamps\b/,
  pspl: /spotlight/,
  slp: /secret lair promo|\bslp\b|prize|showdown/,
  "7ed": /\b7th\b|seventh|\b7ed\b/,
  mmq: /mercadian|\bmmq\b/,
  rvr: /ravnica remastered|\brvr\b/,
  tmt: /tmnt|turtles/,
  tla: /avatar|\btla\b|airbender/,
  msh: /marvel|\bmsh\b/,
  rex: /jurassic|\brex\b/,
  blc: /bloomburrow|\bblc\b/,
  sld: /secret lair|\bsld\b/,
};
/** Scryfall promo types a title must name. */
const MTG_MARKERS: Record<string, RegExp> = {
  serialized: /serial|numbered|\/\s*500\b/,
  raisedfoil: /raised/,
  neonink: /neon/,
  embossed: /emblem|embossed/,
  sldbonus: /rainbow|bonus|\b700\d\b/,
  headliner: /gold|signature|stamped|raised|headliner/,
};
/**
 * Treatments a title must name OR the listing must carry the card's own collector number: the same card's plain printing
 * shares the name, the set and often "borderless" (10-18 hand check: textured Spectacular Spider-Man #236-241, ~$200-700,
 * read against the $15 borderless #14; Japan showcase Llanowar Elves #429, ~$220, against the $2 #227).
 */
const MTG_TREATMENTS: Record<string, RegExp> = {
  textured: /textured/,
  japanshowcase: /japan|anime|showcase/,
  fracturefoil: /fracture/,
  surgefoil: /surge/,
  galaxyfoil: /galaxy/,
  halofoil: /halo/,
  confettifoil: /confetti/,
  manafoil: /mana foil/,
  silverfoil: /silver/,
};
/** Printings that are foil by nature: the title may name the treatment instead of "foil". */
const MTG_FOIL_BY_NATURE = new Set(["serialized", "raisedfoil", "neonink", "embossed", "sldbonus", "textured", "fracturefoil", "surgefoil", "galaxyfoil", "halofoil", "confettifoil", "manafoil", "silverfoil"]);
/** Yu-Gi-Oh! rarities a title must name (the common ones share a print code with them). */
const YGO_RARITY_WORDS = ["ghost", "ultimate", "prismatic", "starlight", "quarter century", "platinum", "collector", "mosaic", "starfoil"];

/**
 * Printing tags (tcg_cards.variant) the matcher knows how to require in a title. A tag outside these is NOT refereed: the
 * matcher would fall back to the base printing and call a rare version absurd next to its $3 common copies (10-13 local
 * run: Magnificent Monsters "gmr" printings read against the ultra rare; One Piece "gold" Luffy against the normal one).
 */
const KNOWN_PRINTINGS: Partial<Record<GameId, Record<string, RegExp | null>>> = {
  yugioh: {
    "": null, utr: /ultimate/, "quarter-century-secret-rare": /quarter century|qcsr|25th/, "platinum-secret-rare": /platinum/, starfoil: /starfoil/,
    "secret-rare": /secret/, "starlight-rare": /starlight/, "mosaic-rare": /mosaic/, "chaos-neos-misprint": /misprint|chaos neos/,
  },
  onepiece: {
    "": null, manga: /manga/, "alt-art": /alt|parallel|\baa\b/, parallel: /alt|parallel|\baa\b/, special: /special|\bsp\b|super alt|\bsar\b|treasure/,
    "full-art": /full art/, "textured-foil": /textured/, "pirate-foil": /pirate/, "jolly-roger-foil": /jolly roger/,
  },
  lorcana: { "": null, enchanted: /enchanted/, special: null },
};
/** Sets whose cards are tournament prizes or one-offs: no liquid market of the same printing to read (a $50,000 YCS prize card). */
const PRIZE_SET = /prize|championship|tournament|judge|challenge|participation|staff|trophy/i;

/** Can the referee read this printing at all? (Magic and Pokemon: always; their matchers carry the printing in the card's own fields.) */
export function refereeable(c: RefereeCard): boolean {
  if (c.game === "pokemon") return true;
  // Lorcana / One Piece promo sets: many look-alike promo versions under one number (a $1,143 Promo Set 1 Mickey read against $29 ones).
  if ((c.game === "lorcana" || c.game === "onepiece") && /promo/i.test(c.setName)) return false;
  // One Piece prints every version of a card (alt art, manga, SP, "The Best" reprints) under ONE code, so a special version's
  // asks mix its siblings (a $3,916 manga Gear 5 Luffy read against $599 "The Best" reprints): only the base printing is read.
  if (c.game === "onepiece" && (c.printing ?? "") !== "") return false;
  if (c.game === "mtg") {
    // A lettered collector number ("410a") is a variant the titles rarely tell apart, unless Scryfall names its treatment (serialized "335z").
    const lettered = /[a-z]$/i.test(c.number);
    return !lettered || (c.promoTypes ?? "").split(",").some((p) => MTG_MARKERS[p]);
  }
  if (PRIZE_SET.test(c.setName)) return false;
  const known = KNOWN_PRINTINGS[c.game];
  return !!known && Object.prototype.hasOwnProperty.call(known, c.printing ?? "");
}

/** The Browse search text, first try then fallback (the fallback runs only when the first finds too little). */
export function refereeQueries(c: RefereeCard): [string, string] {
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const foil = c.variant === "foil" || c.variant === "etched";
  switch (c.game) {
    case "mtg":
      return [clean(`${frontName(c.name)} ${c.setName}`), clean(`${frontName(c.name)} mtg ${foil ? "foil" : ""}`)];
    case "pokemon":
      return [clean(`${c.name} ${c.number} ${c.setName}`), clean(`${c.name} ${c.setName} pokemon`)];
    case "yugioh":
      return [clean(`${c.number} ${c.name}`), clean(`${c.name} ${c.number.replace(/-EN0?/i, " ")}`)];
    case "onepiece":
      return [clean(`${c.name} ${c.number}`), clean(`${c.name} ${c.number} ${c.printing ?? ""}`)];
    default:
      return [clean(`${c.name} ${c.subtitle ?? ""} ${c.number} lorcana`), clean(`${c.name} ${c.subtitle ?? ""} ${c.rarity ?? ""} lorcana`)];
  }
}

/** Does this listing title describe one raw, English copy of exactly this printing (and finish)? */
export function refereeMatcher(c: RefereeCard): (title: string) => boolean {
  const front = frontName(c.name).toLowerCase();
  const nameW = words(front);
  const flavW = c.flavorName ? words(c.flavorName) : [];
  const celebrationSet = /celebration|30th/i.test(c.setName);
  return (title: string) => {
    const t = title.toLowerCase().replace(/δ/g, " delta ");
    if (REJECT.some((r) => r.test(t))) return false;
    // The 2026 "30th Celebration" reprints of vintage cards ($20-27 Shining Celebi next to $250-550 originals, 10-18), and
    // 2021 Celebrations "Classic Collection" copies: another printing unless the card itself is from such a set.
    if (!celebrationSet && /\b30th\b|celebration/.test(t)) return false;
    const byName = nameW.length > 0 && nameW.every((w) => wordRe(w).test(t));
    const byFlavor = flavW.length > 0 && flavW.every((w) => wordRe(w).test(t));
    if (!byName && !byFlavor) return false;
    switch (c.game) {
      case "mtg":
        return mtgPrinting(c, t, front, byFlavor);
      case "pokemon":
        return pokemonPrinting(c, t);
      case "yugioh":
        return yugiohPrinting(c, t);
      case "onepiece":
        return onePiecePrinting(c, t);
      default:
        return lorcanaPrinting(c, t);
    }
  };
}

function mtgPrinting(c: RefereeCard, t: string, front: string, byFlavor: boolean): boolean {
  const num = c.number.replace(/[^0-9]/g, "").replace(/^0+/, "");
  // A collector number counts as a standalone token: 3+ digits, or "#N", "N/total", zero-padded "00N" ("Horizons 2" is not #2).
  const numRe = !num
    ? null
    : num.length >= 3
      ? new RegExp(`(^|[\\s#(\\[])0*${num}([\\s/)\\],]|$)`)
      : new RegExp(`#\\s*0*${num}\\b|(^|\\s)0+${num}\\b|(^|[\\s(\\[])${num}\\s*/\\s*\\d`);
  const numOk = !!numRe && numRe.test(t);
  // A one-word name also lives inside other names ("Unleash Fury" is not Fury): then it needs its flavor name or its number.
  if (!byFlavor && words(front).length === 1) {
    const stripped = t.replace(/\b(mtg|magic|the gathering|foil|nm|lp|near mint|\d+x|x\d+)\b/g, " ").replace(/\s+/g, " ");
    if (new RegExp(`[a-z']+ ${esc(front)}\\b`).test(stripped) && !numOk) return false;
  }
  const types = (c.promoTypes ?? "").split(",").filter(Boolean);
  const foil = c.variant === "foil" || c.variant === "etched";
  const nonfoilWord = /non[-\s]?foil|normal|regular/.test(t);
  const foilByNature = types.some((p) => MTG_FOIL_BY_NATURE.has(p));
  if (foil && (nonfoilWord || (!foilByNature && !/foil/.test(t)))) return false;
  if (!foil && /foil/.test(t) && !nonfoilWord) return false;
  if (c.variant === "etched" && !/etched/.test(t)) return false;
  for (const p of types) if (MTG_MARKERS[p] && !MTG_MARKERS[p].test(t)) return false;
  for (const p of types) if (MTG_TREATMENTS[p] && !MTG_TREATMENTS[p].test(t) && !numOk) return false;
  // A borderless printing names itself (or carries its number): "Mind Stone Foil GameStop Promo" is another card.
  if (c.borderColor === "borderless" && !/borderless|full art|showcase/.test(t) && !numOk) return false;
  // The set must be named (code, words or a known alias): a number alone is no evidence, old sets share them (Summer Magic
  // Jayemdae Tome #258, $2,775, matched $4 Revised copies, also #258).
  const code = (c.setCode ?? "").toLowerCase();
  const setW = words(c.setName);
  const alias = MTG_SET_ALIAS[code];
  return (!!code && code.length >= 3 && wordRe(code).test(t)) || (setW.length > 0 && setW.every((w) => t.includes(w))) || (!!alias && alias.test(t));
}

function pokemonPrinting(c: RefereeCard, t: string): boolean {
  const num = c.number.toLowerCase();
  const numRe = /^\d+$/.test(num)
    ? new RegExp(`(^|[^0-9])0*${num}\\s*/\\s*0*${c.setTotal ?? "\\d+"}([^0-9]|$)|#\\s*0*${num}([^0-9]|$)`)
    : wordRe(num);
  if (!numRe.test(t)) return false;
  const reverse = /reverse/.test(t);
  if ((c.variant === "reverseHolofoil") !== reverse) return false;
  const first = c.variant.startsWith("1stEdition") || !!c.firstEdition;
  if (first !== /\b(1st|first)\s*(edition|ed)\b/.test(t)) return false;
  if (/\bstamp(ed)?\b|prerelease|staff|world championship|\bwc\b/.test(t)) return false;
  if (/holo/i.test(c.variant) && /non[-\s]?holo|regular|deck exclusive/.test(t)) return false;
  // "Gold foil" Pokemon cards are metal novelty fakes (a Magic or One Piece "gold" printing is real, so this is Pokemon only).
  if (/gold\s*foil|gold\s*metal/.test(t)) return false;
  return true;
}

function yugiohPrinting(c: RefereeCard, t: string): boolean {
  const [pre, post] = c.number.toLowerCase().split("-");
  const codeRe = post ? new RegExp(`${esc(pre)}\\s*-?\\s*(en)?\\s*0*${esc(post.replace(/^en0*/, ""))}([^0-9]|$)`) : wordRe(pre);
  if (!codeRe.test(t)) return false;
  // An original North American print ("LOB-121", no EN) is not its 25th Anniversary reprint ("LOB-EN121"), 10-18.
  if (post && !/^en/.test(post) && new RegExp(`${esc(pre)}\\s*-?\\s*en\\s*\\d`).test(t)) return false;
  if (!/25th/i.test(c.setName) && /\b25th\b/.test(t)) return false;
  if (!!c.firstEdition !== /\b(1st|first)\b/.test(t)) return false;
  const rarity = `${c.rarity ?? ""} ${c.printing ?? ""}`.toLowerCase().replace(/-/g, " ");
  for (const w of YGO_RARITY_WORDS) if (rarity.includes(w) && !t.includes(w)) return false;
  const need = KNOWN_PRINTINGS.yugioh?.[c.printing ?? ""];
  if (need && !need.test(t)) return false;
  const misprint = /misprint/.test(c.printing ?? "");
  if (misprint !== /misprint|chaos neos/.test(t)) return false;
  return true;
}

function onePiecePrinting(c: RefereeCard, t: string): boolean {
  if (!t.includes(c.number.toLowerCase())) return false;
  const p = c.printing ?? "";
  const need = KNOWN_PRINTINGS.onepiece?.[p];
  if (need && !need.test(t)) return false;
  // The base printing shares its code with every special one: a title naming a treatment is another printing.
  if (p === "" && /manga|alt|parallel|\baa\b|\bsp\b|special|gold|serial|treasure|full art|textured|pirate|jolly roger|\bspr\b/.test(t)) return false;
  if (p !== "manga" && /manga/.test(t)) return false;
  return true;
}

function lorcanaPrinting(c: RefereeCard, t: string): boolean {
  if (!words(c.subtitle ?? "").every((w) => wordRe(w).test(t))) return false;
  if (!new RegExp(`(^|[^0-9])${esc(c.number)}([^0-9]|$)`).test(t)) return false;
  const rarity = (c.rarity ?? "").toLowerCase();
  if (["enchanted", "iconic", "epic"].includes(rarity) && !t.includes(rarity)) return false;
  // A regular card shares its name and subtitle with its enchanted / iconic / epic version.
  if (!["enchanted", "iconic", "epic"].includes(rarity) && /enchanted|iconic|\bepic\b/.test(t)) return false;
  if (c.variant === "foil" && !["enchanted", "iconic", "epic"].includes(rarity) && !/foil/.test(t)) return false;
  return true;
}

const quantile = (sorted: number[], f: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * f))];

/** The asks that matched, summarized: the played ones count in n but not in the NM figures. The card's own name never reads as a condition. */
export function summarizeAsks(c: RefereeCard, matched: { title: string; price: number }[]): AskReading {
  const own = words(`${frontName(c.name)} ${c.subtitle ?? ""}`);
  const nm = matched
    .filter((m) => {
      let t = m.title.toLowerCase();
      for (const w of own) t = t.replace(wordRe(w), " ");
      return !PLAYED.test(t);
    })
    .map((m) => m.price)
    .sort((a, b) => a - b);
  const date = (c.releaseDate ?? "").replace(/\//g, "-");
  return {
    n: matched.length,
    nNm: nm.length,
    median: nm.length ? quantile(nm, 0.5) : null,
    q75: nm.length ? quantile(nm, 0.75) : null,
    vintage: date !== "" && date < EBAY_REFEREE.vintageBefore,
  };
}

const x = (n: number) => `${n.toFixed(1)}x`;

/** The verdict on `to` (the market price shown) against a reading: high = hide, check = hand-check list, ok, none = nothing listed. */
export function refereeVerdict(to: number, r: AskReading): { verdict: RefereeVerdict; reason: string } {
  const T = EBAY_REFEREE;
  if (r.n === 0 || r.nNm === 0 || r.median == null || r.q75 == null) return { verdict: "none", reason: r.n ? "only played copies listed on eBay" : "nothing listed on eBay" };
  const [over, min] = r.vintage ? [T.overUpperVintage, T.vintageMinAsks] : [T.overUpper, T.minAsks];
  if (r.nNm >= min && to >= over * r.q75) return { verdict: "high", reason: `ebay asks: ${x(to / r.q75)} the upper asks (${r.nNm} listed)` };
  if (to >= T.absurd * r.median) return { verdict: "high", reason: `ebay asks: ${x(to / r.median)} the median ask (${r.nNm} listed)` };
  // Too few asks to hide on, or a gap the rule leaves to a person: the hand-check list (shown on the site meanwhile).
  if (to >= T.overMedian * r.median) return { verdict: "check", reason: `ebay asks: ${x(to / r.median)} the median ask (${r.nNm} listed)` };
  return { verdict: "ok", reason: "" };
}
