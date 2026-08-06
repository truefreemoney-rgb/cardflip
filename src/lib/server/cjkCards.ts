import "server-only";
import { db } from "@/lib/db";
import type { CardPrice, PokemonCard, ScanLanguage } from "@/lib/types";

/**
 * Shared plumbing for Japanese and Traditional Chinese card lookup. Both hit
 * the same wall on TCGdex: name-search doesn't work for either locale
 * (verified directly — an exact, verbatim name still returns []), so both
 * search a local mirror instead (see scripts/sync-cjk-cards.mjs) and only
 * call TCGdex live for one-off detail/pricing lookups on actual candidates.
 */

type CjkLanguage = Extract<ScanLanguage, "ja" | "zh">;

const CONFIG: Record<CjkLanguage, { table: "jp_cards" | "zh_cards"; tcgdexLocale: string }> = {
  ja: { table: "jp_cards", tcgdexLocale: "ja" },
  zh: { table: "zh_cards", tcgdexLocale: "zh-tw" },
};

interface CjkCardRow {
  id: string;
  name: string;
  set_id: string;
  set_name: string;
  local_id: string;
}

export interface CjkCardRef {
  id: string;
  name: string;
  setName: string;
  localId: string;
}

function toRef(r: CjkCardRow): CjkCardRef {
  return { id: r.id, name: r.name, setName: r.set_name, localId: r.local_id };
}

function levenshtein(a: string, b: string): number {
  const dp: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) dp[j] = j;

  for (let i = 1; i <= a.length; i++) {
    let prevDiag = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j];
      dp[j] =
        a[i - 1] === b[j - 1]
          ? prevDiag
          : 1 + Math.min(prevDiag, dp[j], dp[j - 1]);
      prevDiag = temp;
    }
  }
  return dp[b.length];
}

// Reused across requests in the same server process — a few thousand short
// strings per language is cheap to hold in memory and avoids re-querying
// SQLite for every fuzzy scan.
const allNamesCache = new Map<CjkLanguage, CjkCardRow[]>();

function getAllNames(lang: CjkLanguage): CjkCardRow[] {
  let cached = allNamesCache.get(lang);
  if (!cached) {
    cached = db
      .prepare(`SELECT id, name, set_id, set_name, local_id FROM ${CONFIG[lang].table}`)
      .all() as unknown as CjkCardRow[];
    allNamesCache.set(lang, cached);
  }
  return cached;
}

/**
 * Count of characters shared between two strings regardless of position
 * (each character in `b` can only be claimed once). Edit distance alone
 * under-credits this: Tesseract's Chinese model doesn't just substitute a
 * character, it frequently gets the outer characters wrong while nailing the
 * middle one (confirmed directly — "皮卡丘" repeatedly came back with the
 * correct middle character 卡 but two unrelated ones around it), and that
 * pattern still costs a full edit-distance point per wrong character even
 * though a real signal survived.
 */
function charOverlap(a: string, b: string): number {
  const remaining = [...b];
  let overlap = 0;
  for (const ch of a) {
    const idx = remaining.indexOf(ch);
    if (idx !== -1) {
      overlap++;
      remaining.splice(idx, 1);
    }
  }
  return overlap;
}

/**
 * Characters matching at the *same index* in both strings. OCR reads
 * left-to-right, so a shared character in the same position is much
 * stronger evidence than an anywhere-match — it breaks ties correctly where
 * overlap alone can't (confirmed directly: the OCR misread "皮卡丘" as
 * "反卡乒", which tied 皮卡丘 itself against an unrelated card that also
 * happens to contain 卡, just in the wrong slot; position resolves it).
 */
function positionalOverlap(a: string, b: string): number {
  let matches = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches;
}

/**
 * Client-side OCR for CJK scripts is meaningfully less accurate than
 * English — confirmed directly for both Japanese ("ピカチュウ" → "ピカ チュ
 * ワウ") and Chinese, where it's worse: "皮卡丘" came back with only one of
 * three characters correct across repeated tests, even at high resolution
 * with a proper CJK font. An exact-substring match misses constantly, and
 * pure edit distance is too strict for that error pattern — a name is
 * accepted here if it's either close by edit distance *or* shares enough
 * characters with the query, so a card can still surface even when the
 * scan got most of its name wrong.
 */
function fuzzySearch(lang: CjkLanguage, name: string, limit: number): CjkCardRef[] {
  const maxDistance = Math.max(1, Math.ceil(name.length * 0.6));
  const minOverlap = Math.max(1, Math.ceil(name.length / 2));

  const scored = getAllNames(lang)
    .map((row) => ({
      row,
      distance: levenshtein(name, row.name),
      overlap: charOverlap(name, row.name),
      positional: positionalOverlap(name, row.name),
    }))
    .filter((s) => s.distance <= maxDistance || s.overlap >= minOverlap)
    .sort(
      (a, b) =>
        b.positional - a.positional || b.overlap - a.overlap || a.distance - b.distance,
    );

  return scored.slice(0, limit).map((s) => toRef(s.row));
}

export function searchCjkCardsLocal(
  lang: CjkLanguage,
  name: string,
  number?: string | null,
): CjkCardRef[] {
  const table = CONFIG[lang].table;
  const needle = `%${name}%`;

  const exact = number
    ? (db
        .prepare(
          `SELECT id, name, set_id, set_name, local_id FROM ${table} WHERE name LIKE ? AND local_id = ? LIMIT 12`,
        )
        .all(needle, number.padStart(3, "0")) as unknown as CjkCardRow[])
    : (db
        .prepare(
          `SELECT id, name, set_id, set_name, local_id FROM ${table} WHERE name LIKE ? LIMIT 12`,
        )
        .all(needle) as unknown as CjkCardRow[]);

  // A number filter that matches nothing (misread by OCR) shouldn't hide an
  // otherwise-good name match — fall back to name-only rather than empty.
  if (number && exact.length === 0) {
    return searchCjkCardsLocal(lang, name, null);
  }

  if (exact.length > 0) return exact.map(toRef);

  return fuzzySearch(lang, name, 8);
}

interface TcgdexPriceBlock {
  cardmarket?: { avg?: number | null; trend?: number | null; low?: number | null } | null;
}

interface TcgdexCardDetail {
  id: string;
  name: string;
  localId: string;
  rarity?: string;
  set?: { name?: string };
  pricing?: TcgdexPriceBlock;
  /** National Pokédex number(s) — used to resolve a readable English name. */
  dexId?: number[];
}

/**
 * "ピカチュウ" or "皮卡丘" identifies the right card, but doesn't tell an
 * English-only user what it says. Rather than a live translation call, this
 * looks up the species' English name locally (see species_names /
 * scripts/sync-species-names.mjs) so the UI can show it as a plain overlay.
 */
function getEnglishName(dexId?: number[]): string | null {
  const id = dexId?.[0];
  if (!id) return null;
  const row = db
    .prepare("SELECT name_en FROM species_names WHERE dex_id = ?")
    .get(id) as { name_en: string } | undefined;
  return row?.name_en ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Same reasoning as tcg.ts's retry wrapper: transient upstream failures are
 * common enough to be worth one or two retries rather than surfacing as a
 * dead end immediately. */
async function fetchJsonWithRetry<T>(url: string): Promise<T | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) return (await res.json()) as T;
      if (res.status < 500) return null;
    } catch {
      clearTimeout(timeout);
    }
    if (attempt < 3) await sleep(250 * attempt);
  }
  return null;
}

function mapCjkPricing(pricing?: TcgdexPriceBlock): CardPrice[] {
  const cm = pricing?.cardmarket;
  if (!cm) return [];

  const market = cm.trend ?? cm.avg ?? null;
  if (market === null) return [];

  return [
    {
      source: "cardmarket",
      variant: "average",
      // Cardmarket is a EU marketplace; this is cross-market pricing for a
      // Japanese/Chinese card, not a local-market price — labeled so it
      // isn't mistaken for one.
      label: "Average (EUR, cross-market)",
      market,
      low: cm.low ?? null,
      high: null,
    },
  ];
}

/**
 * The local index only has name/set/number (that's all the per-set listing
 * endpoint returns) — rarity and pricing require one extra call per card, so
 * this is only called for the handful of candidates a user is actually
 * looking at, never for the whole search result set.
 */
export async function fetchCjkCardDetail(
  lang: CjkLanguage,
  id: string,
): Promise<PokemonCard | null> {
  const card = await fetchJsonWithRetry<TcgdexCardDetail>(
    `https://api.tcgdex.net/v2/${CONFIG[lang].tcgdexLocale}/cards/${id}`,
  );
  if (!card) return null;

  return {
    id: card.id,
    name: card.name,
    setName: card.set?.name ?? "Unknown set",
    setSeries: "",
    number: card.localId,
    rarity: card.rarity ?? null,
    // TCGdex has no card-scan image data at all for the "ja"/"zh-tw" locales
    // (confirmed directly — the field is simply absent from every response,
    // and the asset doesn't exist at the predictable CDN path either). A
    // stand-in artwork sprite was tried and rejected — it looked like a card
    // photo without being one, which read as more misleading than a plain
    // "no image" placeholder.
    imageSmall: "",
    imageLarge: "",
    prices: mapCjkPricing(card.pricing),
    englishName: getEnglishName(card.dexId),
  };
}
