/**
 * Joining TCGplayer's catalogue (via tcgcsv.com) to our Pokémon mirror.
 * Pure helpers — used by scripts/backfill-tcgcsv.mjs, the server's daily
 * refresh, and the tests.
 *
 * TCGplayer "groups" are sets: { groupId, name: "ME05: Pitch Black",
 * abbreviation: "PBL", publishedOn }. Our en_cards carry set_code ("PBL")
 * and set_release_date, so the abbreviation is the primary key and the
 * normalised name + release date the fallback. Products carry the collector
 * number in extendedData ("Number" = "001/084"), which is our local_id.
 */

export interface TcgGroup {
  groupId: number;
  name: string;
  abbreviation?: string | null;
  publishedOn?: string | null;
}

export interface MirrorSet {
  name: string;
  code: string | null;
  released: string | null;
}

/** "SV05: Temporal Forces" → "temporal forces"; "XY - Evolutions" → "evolutions". */
export function normalizeSetName(name: string): string {
  const n = name
    .toLowerCase()
    .replace(/^[a-z0-9.&\s]{1,12}?:\s*/i, "") // "SV05: ", "ME: ", "SWSH12: "
    .replace(/^(xy|sm|swsh|sv|me)\s*[-—:]\s*/i, "")
    .replace(/^ex\s+/i, "") // "EX Power Keepers" → "power keepers"
    .replace(/\bpok[eé]mon\b/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  // "McDonald's Promos 2014" is TCGdex's "McDonald's Collection 2014" (10-05: every year unpriced).
  const mcd = /^mcdonald s promos (\d{4})$/.exec(n);
  if (mcd) return `mcdonald s collection ${mcd[1]}`;
  return SET_ALIASES[n] ?? n;
}

/**
 * TCGplayer group name (normalised) → our set name (normalised) where the two
 * catalogues call the same thing differently. Promos are the big one:
 * TCGplayer "SWSH: Sword & Shield Promo Cards" is TCGdex "SWSH Black Star
 * Promos". Applied to both sides, so an alias only has to hit one.
 */
const SET_ALIASES: Record<string, string> = {
  "sword and shield base set": "sword and shield",
  "sm base set": "sun and moon",
  "sword and shield promo cards": "swsh black star promos",
  "sm promos": "sm black star promos",
  "xy promos": "xy black star promos",
  "black and white promos": "bw black star promos",
  "hgss promos": "hgss black star promos",
  "diamond and pearl promos": "dp black star promos",
  "scarlet and violet promo cards": "svp black star promos",
  "mega evolution promo": "mep black star promos",
  "nintendo promos": "nintendo black star promos",
  "scarlet and violet energies": "scarlet and violet energy",
  "mega evolution energies": "mega evolution energy",
  "classic collection": "celebrations classic collection",
  "30th celebration classic collection": "30th classic collection",
  "shiny vault": "hidden fates shiny vault",
  "best of promos": "best of game",
  "radiant collection": "generations radiant collection",
  "mcdonald s 25th anniversary promos": "mcdonald s collection 2021",
  "sm trainer kit lycanroc and alolan raichu": "sm trainer kit lycanroc",
  "sm trainer kit alolan sandslash and alolan ninetales": "sm trainer kit alolan sandslash",
};

function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const ta = Date.parse(a.slice(0, 10)), tb = Date.parse(b.slice(0, 10));
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.abs(ta - tb) / 86_400_000;
}

/**
 * groupId → mirror set name. Abbreviation match wins; else an exact
 * normalised-name match; a set is only claimed once, and when names collide
 * (reprints, "Base Set" vs "Base Set 2") the release dates must agree.
 */
export function matchGroupsToSets(groups: TcgGroup[], sets: MirrorSet[]): Map<number, string> {
  // Several mirror sets can share a code (Crown Zenith + its Galarian
  // Gallery are both "CRZ"), so codes map to lists and the name/date decide.
  const byCode = new Map<string, MirrorSet[]>();
  const byName = new Map<string, MirrorSet[]>();
  for (const s of sets) {
    if (s.code) {
      const key = s.code.toUpperCase();
      const list = byCode.get(key) ?? [];
      list.push(s);
      byCode.set(key, list);
    }
    const key = normalizeSetName(s.name);
    const list = byName.get(key) ?? [];
    list.push(s);
    byName.set(key, list);
  }
  const claimed = new Set<string>();
  const out = new Map<number, string>();
  const claim = (g: TcgGroup, s: MirrorSet) => {
    if (claimed.has(s.name)) return false;
    claimed.add(s.name);
    out.set(g.groupId, s.name);
    return true;
  };
  // Pass 1: abbreviations (exact, case-insensitive); among sets sharing the
  // code, the one whose name matches wins, else the closest release date
  // (within 60 days if both are known).
  // Name hits claim first: a subset can share its parent's code and date (30th
  // Celebration and its Classic Collection are both "30C", 10-05), and in
  // groups order the subset could take the parent's set by date alone.
  const pass1 = groups.map((g) => {
    const list = g.abbreviation ? byCode.get(g.abbreviation.toUpperCase()) : undefined;
    const gName = normalizeSetName(g.name);
    const ranked = (list ?? [])
      .map((s) => ({ s, gap: daysBetween(g.publishedOn, s.released), nameHit: normalizeSetName(s.name) === gName }))
      .filter((c) => c.nameHit || c.gap === null || c.gap <= 60)
      .sort((a, b) => Number(b.nameHit) - Number(a.nameHit) || (a.gap ?? 1e9) - (b.gap ?? 1e9));
    return { g, ranked };
  });
  for (const { g, ranked } of pass1) if (ranked[0]?.nameHit) claim(g, ranked[0].s);
  for (const { g, ranked } of pass1) {
    if (out.has(g.groupId)) continue;
    for (const c of ranked) if (claim(g, c.s)) break;
  }
  // Pass 2: names.
  for (const g of groups) {
    if (out.has(g.groupId)) continue;
    const candidates = byName.get(normalizeSetName(g.name));
    if (!candidates?.length) continue;
    const dated = candidates
      .map((s) => ({ s, gap: daysBetween(g.publishedOn, s.released) }))
      // Names already agree; dates only guard against reprints years apart.
      // One candidate: the date can't pick a wrong one (TCGplayer dated POP Series 1-9 2026-10-05, 10-05).
      .filter((c) => candidates.length === 1 || c.gap === null || c.gap <= 120)
      .sort((a, b) => (a.gap ?? 1e9) - (b.gap ?? 1e9));
    for (const c of dated) if (claim(g, c.s)) break;
  }
  return out;
}

/** Collector number from a product's extendedData, normalised like local_id ("001/084" → "1", "TG03/TG30" → "tg03"). */
export function productNumber(product: { extendedData?: { name: string; value: string }[] }): string | null {
  const raw = product.extendedData?.find((e) => e.name === "Number")?.value;
  if (!raw) return null;
  const left = raw.split("/")[0].trim();
  return left.replace(/^0+(?=\d)/, "").toLowerCase() || null;
}

export interface TcgProduct {
  productId: number;
  name?: string;
  extendedData?: { name: string; value: string }[];
}

export interface MirrorCard {
  id: string;
  number: string;
  name: string;
}

/** "Darkrai & Cresselia Legend (Top)" / "Pikachu - 036/128" / "Genesect EX (Team Plasma)" → bare card name. */
export function productCardName(name: string): string {
  return name
    .replace(/δ/g, " delta ") // TCGdex "δ Rainbow Energy" = TCGplayer "Delta Rainbow Energy"
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // "Pokémon Catcher" = "Pokemon Catcher"
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    // "Pikachu - 036/128", "Dark Ivysaur - 6", "Articuno ex - 032 (e-League)"
    .replace(/\s+-\s+[a-z]*\d+(\/\S+)?\s*$/, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A group's products → our cards. Normally by collector number within the
 * set. A reprint subset (Classic Collections, 10-05) prints each card's
 * ORIGINAL number ("Charizard 4/102", "Darkrai & Cresselia Legend (Top)
 * 99/102"), so when number matches mostly disagree on the name, match by name instead: a name must be
 * unique in the set, or a LEGEND's Top/Bottom halves take the lower/higher
 * number. Anything ambiguous stays unmapped (no price beats a wrong price).
 */
export function mapProductsToCards(all: TcgProduct[], cards: MirrorCard[]): Map<number, string> {
  // "[Winner]" / "[Staff]" stamps are their own dearer printings we don't catalogue: never priced as the plain card.
  const products = all.filter((p) => !/\[[^\]]*\]/.test(p.name ?? ""));
  const byNumber = new Map(cards.map((c) => [c.number.replace(/^0+(?=\d)/, "").toLowerCase(), c]));
  const first = (name: string) => productCardName(name).replace(/^basic /, "").split(" ")[0];
  const byNum = new Map<number, string>();
  let tried = 0;
  for (const p of products) {
    const card = byNumber.get(productNumber(p) ?? "");
    if (!card) continue;
    tried++;
    // Each product must agree on the name too: a promo group also holds other sets' Prerelease
    // stamps under THEIR numbers ("Ivysaur 35/100" is not Nintendo promo #35 Pikachu δ, 10-05).
    if (!p.name || first(p.name) === first(card.name)) byNum.set(p.productId, card.id);
  }
  // Numbers line up with names = an ordinary set. Mostly disagreeing = the numbers are the originals'.
  if (byNum.size > 0 && byNum.size * 2 >= tried) return byNum;
  const out = new Map<number, string>();
  const byName = new Map<string, MirrorCard[]>();
  for (const c of [...cards].sort((a, b) => a.number.localeCompare(b.number, "en", { numeric: true }))) {
    const key = productCardName(c.name);
    byName.set(key, [...(byName.get(key) ?? []), c]);
  }
  const claimed = new Set<string>();
  for (const p of products) {
    if (!p.name) continue;
    // TCGplayer spells out what TCGdex leaves off or prints as a glyph: "Palkia LV.X" (ours Palkia), "Umbreon Star" (ours Umbreon ☆).
    const key = productCardName(p.name);
    const list = byName.get(key) ?? byName.get(key.replace(/ (lv x|star)$/, ""));
    const half = /\(top\)/i.test(p.name) ? 0 : /\(bottom\)/i.test(p.name) ? 1 : null;
    const card = half === null ? (list?.length === 1 ? list[0] : undefined) : list?.length === 2 ? list[half] : undefined;
    // Two products reading as one name ("Bulbasaur" and "Bulbasaur (Blue Border)"): neither is sure.
    if (half === null && products.filter((q) => q.name && productCardName(q.name) === key).length > 1) continue;
    if (!card || claimed.has(card.id)) continue;
    claimed.add(card.id);
    out.set(p.productId, card.id);
  }
  return out;
}

/**
 * TCGplayer sells a Trainer Kit's two decks as ONE group ("XY Trainer Kit:
 * Sylveon & Noivern", both decks numbered 1-30); TCGdex has a set per deck
 * ("XY trainer Kit (Sylveon)"). The mirror sets for a kit group with each
 * deck's tag, or null when the group isn't a kit we hold.
 */
export function kitHalves(groupName: string, setNames: string[]): { set: string; tag: string }[] | null {
  const m = /^(\w+) trainer kit(?: (\d))?: (.+?) & (.+)$/i.exec(groupName.trim());
  if (!m) return null;
  const era = m[1].toLowerCase() === "hgss" ? "hs" : m[1].toLowerCase();
  const kitNo = m[2] && m[2] !== "1" ? m[2] : "";
  const tags = [m[3], m[4]].map((t) => t.trim().toLowerCase());
  const out: { set: string; tag: string }[] = [];
  for (const name of setNames) {
    const s = /^(\w+) trainer kit(?: (\d))? \((.+)\)$/i.exec(name.trim());
    if (!s || s[1].toLowerCase() !== era || (s[2] ?? "") !== kitNo) continue;
    const tag = s[3].trim().toLowerCase();
    if (tags.includes(tag)) out.push({ set: name, tag });
  }
  return out.length ? out : null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A kit group's products → the two decks' cards. A number alone is ambiguous
 * (#2 is Fairy Energy in Sylveon's deck, Gourgeist in Noivern's), so a
 * product maps only when its number AND first name word agree with exactly
 * one card. A product naming its deck ("Switch (Noivern)", "Furfrou (#16 -
 * Sylveon)") looks only in that deck, falling back to a name unique there
 * (TCGplayer files Noivern's Switch as #4, ours #29).
 */
export function mapKitProducts(products: TcgProduct[], halves: { tag: string; cards: MirrorCard[] }[]): Map<number, string> {
  const out = new Map<number, string>();
  const claimed = new Set<string>();
  const bare = (n: string) => n.replace(/^0+(?=\d)/, "").toLowerCase();
  const first = (n: string) => productCardName(n).split(" ")[0];
  for (const p of products) {
    if (!p.name) continue;
    const name = p.name;
    const named = halves.filter((h) => new RegExp(`[(-]\\s*${escapeRe(h.tag)}\\s*\\)`, "i").test(name));
    const pool = (named.length === 1 ? named : halves).flatMap((h) => h.cards);
    const num = productNumber(p);
    const byNum = pool.filter((c) => num !== null && bare(c.number) === num && first(c.name) === first(name));
    let card = byNum.length === 1 ? byNum[0] : undefined;
    if (!card && named.length === 1) {
      const same = pool.filter((c) => productCardName(c.name) === productCardName(name));
      if (same.length === 1) card = same[0];
    }
    if (!card || claimed.has(card.id)) continue;
    claimed.add(card.id);
    out.set(p.productId, card.id);
  }
  return out;
}

/**
 * Poké Ball / Master Ball pattern reverse holos (Scarlet & Violet era
 * subsets: Prismatic Evolutions, Black Bolt / White Flare, ...). TCGplayer
 * lists each as its OWN product — "Harlequin (Poke Ball Pattern)" — whose
 * only subtype is "Holofoil", and both products map to the same card. Read
 * as a plain "holofoil" that price became the default quote and the listing
 * said "Printing: Holofoil" for an uncommon trainer (Chris, 09-03). These
 * are their own variants, priced and labelled as such. (Built 09-03, pulled
 * with the printing work the same day, back 09-27 for the Printing dropdown.)
 * 10-17 (Chris, asked since 09-03: "they all have different prices"): Ascended Heroes gives every card TWO pattern
 * reverses, a theme ball "(Friend Ball)" / "(Poke Ball)" (no "Pattern") / "(Team Rocket)" and "(Energy Symbol
 * Pattern)"; both had been read as one plain reverse holo. scripts/_pattern-scan.mjs lists every such product.
 * 10-25 (TASKS C12, Chris's own-price rule): a Pokémon Center Exclusive copy of an SV / ME promo ("Snorlax - 051
 * (Pokemon Center Exclusive)", "Flutter Mane - 097 (Pokemon Center)") is its own printing the same way, at 6-25x the
 * plain card (26 promos: Snorlax $266.78 vs $16.82, Wobbuffet $96.41 vs $3.87). Not a pattern, but the same shape: a
 * second product on one card whose name says which printing it is.
 */
export type PatternVariant =
  | "pokeBallPattern"
  | "masterBallPattern"
  | "friendBallPattern"
  | "loveBallPattern"
  | "duskBallPattern"
  | "quickBallPattern"
  | "teamRocketPattern"
  | "energySymbolPattern"
  | "pokemonCenterExclusive";

/** A Pokémon Center Exclusive product: "(Pokemon Center Exclusive)", "(Pokémon Center Exclusive)", "(Pokemon Center)". */
const POKEMON_CENTER_PRODUCT = /\(\s*pok[eé]mon\s+center(\s+exclusive)?\s*\)/i;

export function tcgplayerProductPattern(name: string | null | undefined): PatternVariant | null {
  if (!name) return null;
  if (/pok[eé][\s-]*ball[\s-]*pattern|\(pok[eé][\s-]*ball\)/i.test(name)) return "pokeBallPattern";
  if (/master[\s-]*ball[\s-]*pattern/i.test(name)) return "masterBallPattern";
  const ball = name.match(/\((friend|love|dusk|quick)[\s-]*ball(?:[\s-]*pattern)?\)/i);
  if (ball) return `${ball[1].toLowerCase()}BallPattern` as PatternVariant;
  if (/\(team rocket(?:[\s-]*pattern)?\)/i.test(name)) return "teamRocketPattern";
  if (/energy[\s-]*symbol[\s-]*pattern/i.test(name)) return "energySymbolPattern";
  if (POKEMON_CENTER_PRODUCT.test(name)) return "pokemonCenterExclusive";
  return null;
}

/**
 * A stamped copy of a promo that TCGplayer sells as its own product beside the plain one: "[Staff]" prerelease
 * stamps, Worlds placement stamps ("[Champion]", "[Finalist]", "[Top 32]", "[Participation]"). Our catalog has the
 * plain card only, and both products map to it, so whichever came first in the group priced the card: Entei SM219
 * showed the Staff stamp's $205 instead of the plain promo's $22 for five months, 14 more SM/SWSH prerelease promos
 * the same way (10-22). A stamped product never prices a plain card. Pokémon Center Exclusive copies were stamps here
 * for a day (10-25, Eevee SVP 173 showed the exclusive's $75.82 beside the plain card's $9.13) and are their own
 * printing since (tcgplayerProductPattern "pokemonCenterExclusive"): they still never price the plain card.
 */
export function tcgplayerProductStamp(name: string | null | undefined): boolean {
  if (!name) return false;
  return /\[\s*(staff|champion|finalist|semi[\s-]*finalist|quarter[\s-]*finalist|top[\s-]*(16|32|sixteen|thirty[\s-]*two)|participation)\s*\]|\(\s*staff\s*\)|\(prerelease\s*\[staff\]/i.test(name);
}

/** TCGplayer subTypeName → pokemontcg.io's price variant key ("Reverse Holofoil" → "reverseHolofoil"). */
export function tcgplayerVariantKey(subType: string | null | undefined): string {
  if (!subType) return "normal";
  const words = subType.trim().split(/\s+/);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i === 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}
