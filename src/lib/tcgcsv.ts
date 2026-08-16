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
  "shiny vault": "hidden fates shiny vault",
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
  for (const g of groups) {
    const list = g.abbreviation ? byCode.get(g.abbreviation.toUpperCase()) : undefined;
    if (!list?.length) continue;
    const gName = normalizeSetName(g.name);
    const ranked = list
      .map((s) => ({ s, gap: daysBetween(g.publishedOn, s.released), nameHit: normalizeSetName(s.name) === gName }))
      .filter((c) => c.gap === null || c.gap <= 60)
      .sort((a, b) => Number(b.nameHit) - Number(a.nameHit) || (a.gap ?? 1e9) - (b.gap ?? 1e9));
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
      .filter((c) => c.gap === null || c.gap <= 120)
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
