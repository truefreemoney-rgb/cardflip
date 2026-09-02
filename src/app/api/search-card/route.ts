import { NextRequest, NextResponse } from "next/server";
import { mapCard, queryCards, type RawTcgCard } from "@/lib/tcg";
import { fetchCjkCardDetail, searchCjkCardsLocal } from "@/lib/server/cjkCards";
import { getCachedCards, putCachedCards } from "@/lib/server/cardCache";
import {
  isSecretRareNumber,
  normalizeNumber,
  type PrintedNumber,
} from "@/lib/cardNumber";
import {
  englishCardById,
  enrichWithPricing,
  hasEnglishMirror,
  searchEnglishCardsLocal,
} from "@/lib/server/enCards";
import type { ArtStyle, ScanLanguage } from "@/lib/types";
import { parseGame } from "@/lib/games";
import { hasMtgMirror, mtgCardById, searchMtgCardsLocal } from "@/lib/server/mtgCards";
import {
  LIMITS,
  RateLimitError,
  clientIp,
  enforceRateLimit,
  rateLimitResponse,
} from "@/lib/server/rateLimit";

/** The scanner's candidate count — search UIs pass a higher `limit`. */
const DEFAULT_LIMIT = 24;

/** Strip characters that would break the upstream query grammar. */
function sanitize(value: string): string {
  return value.replace(/["\\:*()[\]]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Order matches so the card the seller is actually holding comes first.
 *
 * Exact name beats a substring match: scanning a Base Set "Charizard" was
 * returning "Mega Charizard Y ex", because the upstream sorts by release date
 * and every modern card whose name merely *contains* Charizard is newer. A
 * matching collector number is even stronger evidence, so it outranks both.
 */
function rank(cards: RawTcgCard[], name: string, number: string): RawTcgCard[] {
  const needle = name.toLowerCase().trim();
  const wanted = normalizeNumber(number);

  const score = (card: RawTcgCard): number => {
    const exactName = card.name.toLowerCase().trim() === needle;
    const exactNumber = Boolean(wanted) && normalizeNumber(card.number) === wanted;

    if (exactName && exactNumber) return 0;
    if (exactName) return 1;
    if (exactNumber) return 2;
    // Everything else is a substring hit on a differently-named card.
    return 3;
  };

  return [...cards].sort((a, b) => score(a) - score(b));
}

async function searchCjk(lang: "ja" | "zh", name: string, number: string) {
  // The local index only has name/set/number; rarity + pricing need one
  // extra call per card, so that only happens for the handful of candidates
  // actually being shown, not the whole match set.
  const refs = (await searchCjkCardsLocal(lang, name, number || null)).slice(0, 8);
  const detailed = await Promise.all(refs.map((r) => fetchCjkCardDetail(lang, r.id)));
  return detailed.filter((c) => c !== null);
}

export async function GET(req: NextRequest) {
  // Public route (the landing ticker calls it signed-out) and the Pokémon
  // path can fan out to pokemontcg.io — per-IP cap keeps a script from
  // turning it into a free proxy for the upstream API.
  try {
    enforceRateLimit(`search:${clientIp(req)}`, ...LIMITS.searchCard);
  } catch (err) {
    if (err instanceof RateLimitError) return rateLimitResponse(err);
    throw err;
  }

  const name = sanitize(req.nextUrl.searchParams.get("name") ?? "");
  const number = sanitize(req.nextUrl.searchParams.get("number") ?? "");
  const totalParam = Number(req.nextUrl.searchParams.get("setTotal"));
  const setTotal = Number.isFinite(totalParam) && totalParam > 0 ? totalParam : null;
  const setCode = sanitize(req.nextUrl.searchParams.get("setCode") ?? "") || null;
  const artParam = req.nextUrl.searchParams.get("art");
  const art: ArtStyle = artParam === "standard" || artParam === "full-art" ? artParam : null;
  const langParam = req.nextUrl.searchParams.get("lang");
  const lang: ScanLanguage =
    langParam === "ja" || langParam === "zh" ? langParam : "en";

  // The scanner only needs the top two dozen candidates, but a person
  // *searching* by name wants every printing — a popular Pokémon has 100+.
  // Capped so a crafted URL can't ask for the whole mirror in one response.
  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.trunc(limitParam), 200)
      : DEFAULT_LIMIT;

  // Exact catalog id — the fast path for reopening an already-identified
  // card (wishlist tile, history row, Build listing). One indexed SELECT
  // instead of the ranked name walk; the "Charizard" walk was seconds.
  const exactId = sanitize(req.nextUrl.searchParams.get("id") ?? "");
  if (exactId) {
    if (parseGame(req.nextUrl.searchParams.get("game")) === "mtg") {
      return NextResponse.json({ cards: await mtgCardById(exactId), matchedOn: "id", source: "local" });
    }
    const local = await englishCardById(exactId);
    const cards = local.cards.length ? await enrichWithPricing(local.cards, local.releaseDates) : [];
    return NextResponse.json({ cards, matchedOn: "id", source: "local" });
  }

  // Magic: The Gathering — its own mirror, prices included, no upstream
  // call. Name and/or (collector number + set code) identify a printing.
  // Not cached: the mirror is local and already carries the prices.
  if (parseGame(req.nextUrl.searchParams.get("game")) === "mtg") {
    if (!name && !(number && setCode)) {
      return NextResponse.json(
        { error: "Missing name (or a collector number with its set code, like LTR 187)" },
        { status: 400 },
      );
    }
    if (!(await hasMtgMirror())) {
      return NextResponse.json(
        { error: "The Magic catalogue isn't loaded on this server yet" },
        { status: 503 },
      );
    }
    const cards = await searchMtgCardsLocal(name, number || null, setCode, limit, art);
    const matchedOn = !name ? "number+set" : number ? (setCode ? "name+number+set" : "name+number") : "name";
    return NextResponse.json({ cards, matchedOn, source: "local" });
  }

  const printed: PrintedNumber | null = number
    ? {
        number,
        setTotal,
        setCode,
        isSecretRare: isSecretRareNumber(number, setTotal),
      }
    : null;

  // A name is normally required, but a complete fraction identifies a card on
  // its own — the denominator names the expansion and the numerator picks the
  // card out of it. That's the read that survives when glare or foil wipes out
  // the name band, so it's worth serving rather than rejecting.
  if (!name && !(printed && printed.setTotal)) {
    return NextResponse.json(
      { error: "Missing name (or a full collector number like 25/102)" },
      { status: 400 },
    );
  }

  // Two cards can share a name and number and differ only in set total, so the
  // whole printed fraction goes into the cache key. The limit goes in too when
  // it isn't the default — otherwise a scan's 24-card answer would be served
  // to a search that asked for every printing, and vice versa.
  const cacheNumber = [
    setTotal ? `${number}/${setTotal}` : number,
    limit === DEFAULT_LIMIT ? "" : `#${limit}`,
    art ? `@${art}` : "",
  ].join("");

  // What the answer was actually keyed on, so the client can say how sure the
  // match is rather than presenting a guess and a certainty identically.
  const matchedOn = !name
    ? "number+set"
    : number
      ? setTotal
        ? "name+number+set"
        : "name+number"
      : "name";

  // A fresh local hit skips the network entirely — which also means rescanning
  // the same card twice never depends on the upstream being up.
  const fresh = await getCachedCards(lang, name, cacheNumber, false);
  if (fresh) {
    return NextResponse.json({ cards: fresh.cards, matchedOn, cached: true });
  }

  try {
    if (lang === "ja" || lang === "zh") {
      const cards = await searchCjk(lang, name, number);
      await putCachedCards(lang, name, cacheNumber, cards);
      return NextResponse.json({ cards, matchedOn });
    }

    // English identification comes from our own mirror, so a pokemontcg.io
    // outage can no longer fail a scan. Prices are layered on afterwards and
    // are allowed to fail on their own.
    if (await hasEnglishMirror()) {
      const local = await searchEnglishCardsLocal(name, printed, limit, art);
      if (local.cards.length > 0) {
        const cards = await enrichWithPricing(local.cards, local.releaseDates);

        // Only cache once pricing actually attached. Caching a priceless
        // result would pin a transient upstream outage in place for a day,
        // and there's nothing to gain by it — identification already comes
        // from the local mirror, which is instant either way.
        if (cards.some((c) => c.prices.some((p) => p.market))) {
          await putCachedCards(lang, name, cacheNumber, cards);
        }

        return NextResponse.json({ cards, matchedOn, source: "local" });
      }
    }

    // Everything below queries pokemontcg.io by name, so a fraction-only
    // lookup has nowhere left to go — the mirror is the only source that can
    // answer one, and it already came up empty.
    if (!name) {
      return NextResponse.json({ cards: [], matchedOn });
    }

    // The collector number is a strong disambiguator when OCR found one, but
    // it also rules out every result if OCR misread it — so fall back to the
    // name-only search rather than reporting no matches.
    if (number) {
      const narrowed = await queryCards(
        `name:*${name}* number:${number}`,
        Math.max(DEFAULT_LIMIT, limit),
      );
      if (narrowed.length > 0) {
        const cards = rank(narrowed, name, number).map(mapCard);
        await putCachedCards(lang, name, cacheNumber, cards);
        return NextResponse.json({ cards, matchedOn });
      }
    }

    // Deliberately large. A popular Pokémon has 100+ printings, and the
    // upstream returns them newest-first — at a small page size the exact-name
    // card never arrives to be ranked, which is why a Base Set Charizard came
    // back as "Mega Charizard Y ex". Fetch the field, then rank it ourselves.
    const results = await queryCards(`name:*${name}*`, 250);
    const cards = rank(results, name, number).map(mapCard).slice(0, limit);
    await putCachedCards(lang, name, cacheNumber, cards);
    return NextResponse.json({ cards, matchedOn: "name" });
  } catch (err) {
    // Upstream is down. A stale copy is a far better answer than losing the
    // scan — names, sets and numbers don't change, only prices drift.
    const stale = await getCachedCards(lang, name, cacheNumber, true);
    if (stale) {
      return NextResponse.json({
        cards: stale.cards,
        matchedOn,
        cached: true,
        stale: true,
      });
    }

    console.error("Card lookup failed with no cached copy:", err);
    return NextResponse.json({ error: "Lookup failed" }, { status: 502 });
  }
}
