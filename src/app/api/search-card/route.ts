import { NextRequest, NextResponse } from "next/server";
import { mapCard, queryCards, type RawTcgCard } from "@/lib/tcg";
import { fetchCjkCardDetail, searchCjkCardsLocal } from "@/lib/server/cjkCards";
import { getCachedCards, putCachedCards } from "@/lib/server/cardCache";
import {
  enrichWithPricing,
  hasEnglishMirror,
  searchEnglishCardsLocal,
} from "@/lib/server/enCards";
import type { ScanLanguage } from "@/lib/types";

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
  const wanted = number.replace(/^0+/, "");

  const score = (card: RawTcgCard): number => {
    const exactName = card.name.toLowerCase().trim() === needle;
    const exactNumber =
      Boolean(wanted) && card.number.replace(/^0+/, "") === wanted;

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
  const refs = searchCjkCardsLocal(lang, name, number || null).slice(0, 8);
  const detailed = await Promise.all(refs.map((r) => fetchCjkCardDetail(lang, r.id)));
  return detailed.filter((c) => c !== null);
}

export async function GET(req: NextRequest) {
  const name = sanitize(req.nextUrl.searchParams.get("name") ?? "");
  const number = sanitize(req.nextUrl.searchParams.get("number") ?? "");
  const langParam = req.nextUrl.searchParams.get("lang");
  const lang: ScanLanguage =
    langParam === "ja" || langParam === "zh" ? langParam : "en";

  if (!name) {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }

  // A fresh local hit skips the network entirely — which also means rescanning
  // the same card twice never depends on the upstream being up.
  const fresh = getCachedCards(lang, name, number, false);
  if (fresh) {
    return NextResponse.json({
      cards: fresh.cards,
      matchedOn: number ? "name+number" : "name",
      cached: true,
    });
  }

  try {
    if (lang === "ja" || lang === "zh") {
      const cards = await searchCjk(lang, name, number);
      putCachedCards(lang, name, number, cards);
      return NextResponse.json({ cards, matchedOn: number ? "name+number" : "name" });
    }

    // English identification comes from our own mirror, so a pokemontcg.io
    // outage can no longer fail a scan. Prices are layered on afterwards and
    // are allowed to fail on their own.
    if (hasEnglishMirror()) {
      const local = searchEnglishCardsLocal(name, number || null);
      if (local.cards.length > 0) {
        const cards = await enrichWithPricing(local.cards, local.releaseDates);

        // Only cache once pricing actually attached. Caching a priceless
        // result would pin a transient upstream outage in place for a day,
        // and there's nothing to gain by it — identification already comes
        // from the local mirror, which is instant either way.
        if (cards.some((c) => c.prices.some((p) => p.market))) {
          putCachedCards(lang, name, number, cards);
        }

        return NextResponse.json({
          cards,
          matchedOn: number ? "name+number" : "name",
          source: "local",
        });
      }
    }

    // The collector number is a strong disambiguator when OCR found one, but
    // it also rules out every result if OCR misread it — so fall back to the
    // name-only search rather than reporting no matches.
    if (number) {
      const narrowed = await queryCards(`name:*${name}* number:${number}`, 24);
      if (narrowed.length > 0) {
        const cards = rank(narrowed, name, number).map(mapCard);
        putCachedCards(lang, name, number, cards);
        return NextResponse.json({ cards, matchedOn: "name+number" });
      }
    }

    // Deliberately large. A popular Pokémon has 100+ printings, and the
    // upstream returns them newest-first — at a small page size the exact-name
    // card never arrives to be ranked, which is why a Base Set Charizard came
    // back as "Mega Charizard Y ex". Fetch the field, then rank it ourselves.
    const results = await queryCards(`name:*${name}*`, 250);
    const cards = rank(results, name, number).map(mapCard).slice(0, 24);
    putCachedCards(lang, name, number, cards);
    return NextResponse.json({ cards, matchedOn: "name" });
  } catch (err) {
    // Upstream is down. A stale copy is a far better answer than losing the
    // scan — names, sets and numbers don't change, only prices drift.
    const stale = getCachedCards(lang, name, number, true);
    if (stale) {
      return NextResponse.json({
        cards: stale.cards,
        matchedOn: number ? "name+number" : "name",
        cached: true,
        stale: true,
      });
    }

    console.error("Card lookup failed with no cached copy:", err);
    return NextResponse.json({ error: "Lookup failed" }, { status: 502 });
  }
}
