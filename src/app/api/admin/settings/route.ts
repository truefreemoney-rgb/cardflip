import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdminOwner, AuthError } from "@/lib/server/auth";
import { GATED_GAMES, gamePublic, gamePublicKey, setSetting, type GatedGame } from "@/lib/server/settings";

/**
 * Admin console switches: each game after Pokémon public or admins-only.
 * GET reads them; PATCH flips the ones in the body — `{ games: { lorcana:
 * true } }`, or the original `{ magicPublic: boolean }` for Magic.
 */
async function allSwitches() {
  const games: Record<string, boolean> = {};
  for (const g of GATED_GAMES) games[g] = await gamePublic(g);
  return { magicPublic: games.mtg, games };
}

export async function GET() {
  try {
    await requireAdminOwner();
    return NextResponse.json(await allSwitches());
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
}

export async function PATCH(req: Request) {
  try {
    await requireAdminOwner();
    const body = await req.json().catch(() => null);
    const flips: Array<[GatedGame, boolean]> = [];
    if (typeof body?.magicPublic === "boolean") flips.push(["mtg", body.magicPublic]);
    for (const g of GATED_GAMES) if (typeof body?.games?.[g] === "boolean") flips.push([g, body.games[g]]);
    if (flips.length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    for (const [g, on] of flips) await setSetting(gamePublicKey(g), on ? "1" : "0");
    // The public pages (landing, /help, /terms, /privacy, metadata, OG image)
    // are statically cached — the landing for a day. Bust everything so the
    // flip is visible at once (09-05: Chris flipped it and the site kept
    // saying Magic).
    revalidatePath("/", "layout");
    return NextResponse.json(await allSwitches());
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("settings patch failed:", err);
    return NextResponse.json({ error: "Couldn't save the setting" }, { status: 500 });
  }
}
