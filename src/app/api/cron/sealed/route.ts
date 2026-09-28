import { NextRequest, NextResponse } from "next/server";
import { cronAuthError } from "@/lib/server/cronAuth";
import { hasTcgplayerMap, refreshPokemonPricesFromTcgcsv } from "@/lib/server/pokemonPriceRefresh";
import { scanSealedProducts } from "@/lib/server/sealedPrices";

/**
 * Manual: GET /api/cron/sealed?key=CRON_SECRET[&groups=400]
 *
 * Reads the TCGplayer product lists of up to `groups` due groups at once
 * (the daily job does 30 a run) and then runs the Pokémon price refresh so
 * the sealed products it found are priced today, not tomorrow. For the
 * first fill after deploy and for a look at the feed without waiting.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = cronAuthError(req);
  if (denied) return denied;
  const t0 = Date.now();
  if (!(await hasTcgplayerMap())) {
    return NextResponse.json({ error: "no tcgplayer_products map" }, { status: 503 });
  }
  const groups = Math.min(600, Math.max(1, Number(req.nextUrl.searchParams.get("groups")) || 400));
  const scan = await scanSealedProducts(undefined, groups);
  const refresh = await refreshPokemonPricesFromTcgcsv();
  return NextResponse.json({ scan, refresh, ms: Date.now() - t0 });
}
