import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { setLogoFromCardImage, type SetInfo } from "@/lib/grading";
import { parseGame } from "@/lib/games";
import { listMtgSets } from "@/lib/server/mtgCards";

/**
 * Every English set in the mirror, newest first — the catalogue behind the
 * sealed-product picker. Served from the local mirror like identification
 * (no auth, same as /api/search-card: it's public catalogue data), so the
 * picker works even when every upstream is down.
 */

interface SetRow {
  set_name: string;
  release_date: string;
  sample_image: string;
}

export async function GET(req: NextRequest) {
  try {
    return await listSets(req);
  } catch (err) {
    console.error("Set catalogue failed:", err);
    return NextResponse.json({ error: "Couldn't load the set list" }, { status: 500 });
  }
}

async function listSets(req: NextRequest) {
  // ?game=mtg → the Scryfall mirror's sets (with their set icons).
  if (parseGame(req.nextUrl.searchParams.get("game")) === "mtg") {
    return NextResponse.json({ sets: await listMtgSets() });
  }

  const rows = (await db
    .prepare(
      `SELECT set_name,
              MIN(set_release_date) AS release_date,
              MAX(image_url) AS sample_image
         FROM en_cards
        WHERE set_name != ''
        GROUP BY set_name
        ORDER BY release_date DESC`,
    )
    .all()) as unknown as SetRow[];

  const sets: SetInfo[] = rows.map((row) => ({
    name: row.set_name,
    releaseDate: row.release_date,
    logoUrl: setLogoFromCardImage(row.sample_image ?? ""),
  }));

  return NextResponse.json({ sets });
}
