import { NextRequest, NextResponse } from "next/server";
import { mapCard, queryCards, type RawTcgCard } from "@/lib/tcg";
import { fetchCjkCardDetail, searchCjkCardsLocal } from "@/lib/server/cjkCards";
import type { ScanLanguage } from "@/lib/types";

/** Strip characters that would break the upstream query grammar. */
function sanitize(value: string): string {
  return value.replace(/["\\:*()[\]]/g, " ").replace(/\s+/g, " ").trim();
}

/** Exact name matches should outrank cards that merely contain the term. */
function rank(cards: RawTcgCard[], name: string): RawTcgCard[] {
  const needle = name.toLowerCase();
  return [...cards].sort((a, b) => {
    const aExact = a.name.toLowerCase() === needle ? 0 : 1;
    const bExact = b.name.toLowerCase() === needle ? 0 : 1;
    return aExact - bExact;
  });
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

  try {
    if (lang === "ja" || lang === "zh") {
      const cards = await searchCjk(lang, name, number);
      return NextResponse.json({ cards, matchedOn: number ? "name+number" : "name" });
    }

    // The collector number is a strong disambiguator when OCR found one, but
    // it also rules out every result if OCR misread it — so fall back to the
    // name-only search rather than reporting no matches.
    if (number) {
      const narrowed = await queryCards(`name:*${name}* number:${number}`, 12);
      if (narrowed.length > 0) {
        return NextResponse.json({
          cards: rank(narrowed, name).map(mapCard),
          matchedOn: "name+number",
        });
      }
    }

    const results = await queryCards(`name:*${name}*`, 12);
    return NextResponse.json({
      cards: rank(results, name).map(mapCard),
      matchedOn: "name",
    });
  } catch {
    return NextResponse.json({ error: "Lookup failed" }, { status: 502 });
  }
}
