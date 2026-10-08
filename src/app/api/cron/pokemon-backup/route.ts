import { NextRequest, NextResponse } from "next/server";
import { todayUtc } from "@/lib/priceSeries";
import { cronAuthError } from "@/lib/server/cronAuth";
import { readSeriesMap, upsertSeriesRows } from "@/lib/server/priceBulkWrite";
import { POKEMON_BACKUP_NEEDED_KEY, pokemonBackupFromPokemontcgIo } from "@/lib/server/priceBackups";
import { getSetting } from "@/lib/server/settings";

/**
 * Finishes the day's Pokémon backup (lib/server/priceBackups.ts) when tcgcsv
 * answered nothing and the refresh ran out of time: pokemontcg.io needs ~9
 * minutes for 205 sets, so vercel.json pings this a few times after the
 * morning refresh. Idle (no fetch at all) on a day tcgcsv worked.
 *   GET /api/cron/pokemon-backup            → Bearer CRON_SECRET (Vercel) or ?key=
 *   ...&force=1                             → run even when tcgcsv worked today
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = cronAuthError(req);
  if (denied) return denied;
  const day = todayUtc();
  const needed = (await getSetting(POKEMON_BACKUP_NEEDED_KEY)) === day;
  if (!needed && req.nextUrl.searchParams.get("force") !== "1") return NextResponse.json({ skipped: "tcgcsv worked today", day });
  const t0 = Date.now();
  const existing = await readSeriesMap("pokemon", "tcgplayer");
  const b = await pokemonBackupFromPokemontcgIo(day, existing, new Set(), { deadline: t0 + 240_000 });
  await upsertSeriesRows(b.upserts);
  return NextResponse.json({ day, sets: b.sets, setsDone: b.setsDone, setsFailed: b.setsFailed, setsLeft: b.setsLeft, series: b.upserts.length, ms: Date.now() - t0 });
}
