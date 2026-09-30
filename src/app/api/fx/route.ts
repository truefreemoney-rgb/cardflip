import { NextResponse } from "next/server";
import { getFxRates } from "@/lib/server/fx";

/** Public USD → CAD/GBP/EUR/AUD/NZD rates for the home-currency price hint (lib/server/fx.ts). */
export async function GET() {
  const fx = await getFxRates();
  return NextResponse.json(
    { date: fx?.date ?? null, rates: fx?.rates ?? {} },
    { headers: { "cache-control": "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
