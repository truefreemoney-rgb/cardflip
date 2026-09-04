import { apiPath } from "@/lib/client/basePath";
import type { PrintedNumber } from "@/lib/cardNumber";
import type { ArtStyle, GameId, PokemonCard, ScanLanguage } from "@/lib/types";

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
): Promise<PokemonCard[]> {
  const params = new URLSearchParams({ name, lang });
  if (game !== "pokemon") params.set("game", game);
  if (art) params.set("art", art);
  if (artOnly) params.set("art_series", "1");
  if (firstEdition === true) params.set("first", "1");
  else if (firstEdition === false) params.set("first", "0");
  if (limit) params.set("limit", String(limit));

  if (typeof printed === "string") {
    if (printed) params.set("number", printed);
  } else if (printed) {
    params.set("number", printed.number);
    if (printed.setTotal) params.set("setTotal", String(printed.setTotal));
    if (printed.setCode) params.set("setCode", printed.setCode);
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
