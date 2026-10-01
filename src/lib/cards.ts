import { apiPath } from "@/lib/client/basePath";
import type { PrintedNumber } from "@/lib/cardNumber";
import type { ArtStyle, GameId, MtgCues, PokemonCard, ScanLanguage } from "@/lib/types";
import { mtgCuesToParams } from "@/lib/mtgCues";
import { filterByPrintedNumber, parseCardQuery } from "@/lib/cardNumber";
import { parseMtgQuery } from "@/lib/games";
import { yugiohKey } from "@/lib/yugioh";

/**
 * `printed` carries the whole fraction, not just the collector number. The set
 * total is what separates two cards that share a name and a number — a Base
 * Set Charizard (4/102) from its Base Set 2 reprint (4/130) — so dropping it
 * here would leave the server ranking on a coin flip.
 *
 * `game` picks the catalogue: Pokémon (default) or MTG, where `printed.setCode`
 * is the printed 3–5 letter set code ("LTR") and the set total is unused.
 */
/** Exact catalog-id fetch — one indexed lookup instead of the name walk.
 * Returns null when the id isn't in the mirror (fall back to searchCards). */
export async function fetchCardById(id: string, game: GameId = "pokemon"): Promise<PokemonCard | null> {
  const params = new URLSearchParams({ id });
  if (game !== "pokemon") params.set("game", game);
  const res = await fetch(apiPath(`/api/search-card?${params.toString()}`), {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.cards?.[0] ?? null;
}

/** Every card in a set (Pokémon: set name; MTG: set code), printed order, with the latest held price. */
export async function fetchSetCards(set: string, game: GameId = "pokemon"): Promise<PokemonCard[]> {
  const params = new URLSearchParams({ set });
  if (game !== "pokemon") params.set("game", game);
  const res = await fetch(apiPath(`/api/set-cards?${params.toString()}`), {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Set lookup failed (${res.status})`);
  const data = await res.json();
  return Array.isArray(data.cards) ? data.cards : [];
}

/** The set catalogue for a game, newest first. */
export async function fetchSets(game: GameId = "pokemon"): Promise<import("@/lib/grading").SetInfo[]> {
  const params = new URLSearchParams();
  if (game !== "pokemon") params.set("game", game);
  const res = await fetch(apiPath(`/api/sets${params.size ? "?" + params.toString() : ""}`), {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Set list failed (${res.status})`);
  const data = await res.json();
  return Array.isArray(data.sets) ? data.sets : [];
}

export async function searchCards(
  name: string,
  printed?: PrintedNumber | string | null,
  lang: ScanLanguage = "en",
  /** Omit for the scanner's default (24); search UIs ask for every printing. */
  limit?: number,
  game: GameId = "pokemon",
  /** Vision's frame read — tiebreak between a full-art and a standard printing when the number is unread. */
  art: ArtStyle = null,
  /** MTG: vision saw an Art Series card — only art sets may answer. */
  artOnly = false,
  /** Pokémon: vision's read of the 1st Edition stamp — true ranks the 1st Edition twin first. */
  firstEdition: boolean | null = null,
  /** MTG: the rest of the scan read (finish, treatment, marks, artist, year, border). */
  cues: MtgCues | null = null,
  /** A seller typed the name: Lorcana / One Piece / Yu-Gi-Oh! match it anywhere in the card name. */
  typed = false,
): Promise<PokemonCard[]> {
  const params = new URLSearchParams({ name, lang });
  if (game !== "pokemon") params.set("game", game);
  if (typed) params.set("typed", "1");
  if (art) params.set("art", art);
  if (cues) for (const [k, v] of Object.entries(mtgCuesToParams(cues))) params.set(k, v);
  if (artOnly) params.set("art_series", "1");
  if (firstEdition === true) params.set("first", "1");
  else if (firstEdition === false) params.set("first", "0");
  if (limit) params.set("limit", String(limit));

  if (typeof printed === "string") {
    if (printed) params.set("number", printed);
  } else if (printed) {
    if (printed.number) params.set("number", printed.number);
    if (printed.setTotal) params.set("setTotal", String(printed.setTotal));
    if (printed.setCode) params.set("setCode", printed.setCode);
    if (printed.setName) params.set("setName", printed.setName);
    if (printed.copyrightYear) params.set("year", String(printed.copyrightYear));
    if (printed.subtitle) params.set("sub", printed.subtitle);
    if (printed.variant) params.set("variant", printed.variant);
    if (printed.shaky) params.set("shaky", "1");
  }

  // A hung serverless call (cold start + slow query) used to spin callers'
  // loading states indefinitely (09-02, wishlist tile) — time out into the
  // caller's error path instead so "try again" is on the table.
  // One retry for anything transient — a 429 from the burst limiter, a 5xx,
  // or a cold-start timeout. The scanner walks the queue one card at a time,
  // so an 82-card stress run never exceeds the rate limit; the 3-in-82
  // "card lookup is down" it produced (09-02) were single failed requests
  // that a second attempt would have served. Client 4xx are not retried.
  const url = apiPath(`/api/search-card?${params.toString()}`);
  const attempt = () => fetch(url, { signal: AbortSignal.timeout(15_000) });
  let res: Response;
  try {
    res = await attempt();
  } catch (err) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      res = await attempt();
    } catch {
      throw err;
    }
  }
  if (res.status === 429 || res.status >= 500) {
    const wait = res.status === 429 ? Math.min(3, Number(res.headers.get("Retry-After")) || 2) : 1.5;
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    res = await attempt();
  }
  if (!res.ok) throw new Error(`Search failed (${res.status})`);

  const data = await res.json();
  return data.cards ?? [];
}

// (Four letters before the digits: Yu-Gi-Oh's special editions print "TDGS-ENSE2".)
const CODE_TOKEN = /^[A-Z0-9]{2,6}-[A-Z]{0,4}\d{1,4}[A-Z]?$/i;
const OP_PROMO_TOKEN = /^P-\d{1,3}$/i;
const bareNumber = (n: string) => n.replace(/^0+(?=\d)/, "").toLowerCase();

/**
 * A card number typed without its dash (10-01): One Piece "OP01041" →
 * "OP01-041" and "P117" → "P-117"; Yu-Gi-Oh "LOBEN005" → "LOB-EN005" and
 * "LOB005" → "LOB-005". The part before the dash must hold a letter, and no
 * card name ends in three digits, so a name word is never touched.
 */
function withDash(token: string, game: GameId): string {
  if (token.includes("-")) return token;
  if (game === "onepiece") {
    const m = /^([A-Z]{1,4}\d{2})(\d{3})$/i.exec(token) ?? /^(P)(\d{3})$/i.exec(token);
    return m ? `${m[1]}-${m[2]}` : token;
  }
  const m =
    /^([A-Z0-9]{2,5}?)(EN[A-Z]{0,2}\d{1,3})$/i.exec(token) ??
    /^([A-Z0-9]{2,5}?)((?:DE|FR|IT|SP|PT)\d{3})$/i.exec(token) ??
    /^([A-Z0-9]{2,5})(\d{3})$/i.exec(token);
  return m && /[A-Z]/i.test(m[1]) ? `${m[1]}-${m[2]}` : token;
}

/**
 * What a seller types in a search box ("Charizard 4/102", "Lightning Bolt
 * LTR 187", "Elsa 42/204", "Roronoa Zoro OP01-001", "Dark Magician
 * LOB-EN005") → the right game's catalogue. Every typed-search box goes
 * through here: until 09-30 each box sent only Magic with its game and let
 * Lorcana / One Piece / Yu-Gi-Oh fall through to a Pokémon search (0 hits).
 * `null` = nothing searchable was typed (the caller shows the game's example).
 * `exact` keeps only the typed number when one was typed (a deliberate ask).
 */
export async function searchTyped(
  query: string,
  game: GameId,
  lang: ScanLanguage,
  { limit = 200, exact = true }: { limit?: number; exact?: boolean } = {},
): Promise<PokemonCard[] | null> {
  if (game === "mtg") {
    const run = async (parsed: ReturnType<typeof parseMtgQuery>) => {
      const { name, number, setCode } = parsed;
      if (!name && !(number && setCode)) return null;
      const printed = number || setCode ? { number: number ?? "", setTotal: null, setCode, isSecretRare: false } : null;
      const found = await searchCards(name, printed, lang, limit, "mtg", null, false, null, null, true);
      const hit = number ? found.filter((c) => bareNumber(c.number) === bareNumber(number)) : found;
      // `sure`: something came back and, when a number was typed, a card carries it.
      return { cards: exact && hit.length > 0 ? hit : found, sure: hit.length > 0 };
    };
    // Set codes are printed in capitals; typed in lowercase ("forest blb 280",
    // "vow 24") they read as part of the name, so that reading is the second
    // try, taken when the first found nothing or no card with the typed number.
    const strict = parseMtgQuery(query);
    const first = await run(strict);
    let fallback = first?.cards ?? null;
    const tried = new Set([JSON.stringify(strict)]);
    for (const parsed of [parseMtgQuery(query, true, true), parseMtgQuery(query, true)]) {
      const key = JSON.stringify(parsed);
      if (tried.has(key)) continue;
      tried.add(key);
      // "bot 24" is a card named Bot with the number 24, or set BOT number
      // 24: a reading with no name left is one exact printing, and it leads.
      const onePrinting = !parsed.name && Boolean(parsed.number && parsed.setCode);
      if (first?.sure && !onePrinting) break;
      const next = await run(parsed);
      if (next && (!fallback || fallback.length === 0)) fallback = next.cards;
      if (!next?.sure) continue;
      if (!first?.sure) return next.cards;
      const have = new Set(next.cards.map((c) => c.id));
      return [...next.cards, ...first.cards.filter((c) => !have.has(c.id))];
    }
    return fallback;
  }
  if (game === "onepiece" || game === "yugioh") {
    // One Piece promos print a one-letter code ("P-117"), too short for CODE_TOKEN
    // (10-01: "nami p-117" was searched as a name and found nothing).
    const isCode = (t: string) => CODE_TOKEN.test(t) || (game === "onepiece" && OP_PROMO_TOKEN.test(t));
    const tokens = query.trim().split(/\s+/).filter(Boolean).map((t) => withDash(t, game));
    const code = tokens.find(isCode)?.toUpperCase() ?? null;
    const name = tokens.filter((t) => !isCode(t)).join(" ");
    if (!name && !code) return null;
    const found = await searchCards(name, code, lang, limit, game, null, false, null, null, true);
    if (!exact || !code) return found;
    // Yu-Gi-Oh: "LOB-005" names the card printed "LOB-EN005".
    const same = (n: string) => n.toUpperCase() === code || (game === "yugioh" && yugiohKey(n) !== null && yugiohKey(n) === yugiohKey(code));
    const hit = found.filter((c) => same(c.number));
    return hit.length > 0 ? hit : found;
  }
  const { name, printed } = parseCardQuery(query);
  if (!name && !printed) return null;
  const found = await searchCards(name, printed, lang, limit, game, null, false, null, null, true);
  if (!exact) return found;
  const hit = filterByPrintedNumber(found, printed);
  // A lettered last word read as a number that names nothing: it was part of the name.
  if (hit.length === 0 && printed && !printed.setTotal && /[A-Za-z]/.test(printed.number)) {
    const whole = await searchCards(query.trim(), null, lang, limit, game, null, false, null, null, true);
    if (whole.length > 0) return whole;
  }
  // Lorcana's catalogue totals differ from the printed one on promos — never
  // turn a real name hit into "no cards" over the denominator.
  return game === "lorcana" && hit.length === 0 ? found : hit;
}
