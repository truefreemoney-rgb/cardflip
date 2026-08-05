import { NextRequest, NextResponse } from "next/server";
import { mapCard, queryCards, type RawTcgCard } from "@/lib/tcg";

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

export async function GET(req: NextRequest) {
  const name = sanitize(req.nextUrl.searchParams.get("name") ?? "");
  const number = sanitize(req.nextUrl.searchParams.get("number") ?? "");

  if (!name) {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }

  try {
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
