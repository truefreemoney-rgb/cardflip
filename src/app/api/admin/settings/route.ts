import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdminOwner, AuthError } from "@/lib/server/auth";
import { EBAY_LOCAL_MARKETS_KEY, GATED_GAMES, ebayLocalMarketsOn, gamePublic, gamePublicKey, setSetting, type GatedGame } from "@/lib/server/settings";
import { EMAIL_CONFIRM_KEY, emailConfirmStats, releaseAllPending } from "@/lib/server/emailVerify";
import { emailConfirmActive } from "@/lib/server/mail";

/**
 * Admin console switches: each game after Pokémon public or admins-only.
 * GET reads them; PATCH flips the ones in the body — `{ games: { lorcana:
 * true } }`, or the original `{ magicPublic: boolean }` for Magic.
 *
 * `{ emailConfirm: boolean }` is the email-confirmation switch (emailVerify.ts).
 * On only when the row is exactly "1" (a missing row is off); turning it on
 * needs mail set up on the server (400 otherwise); turning it off also lets
 * every account waiting on a code straight in, and answers how many
 * (`released`). GET carries `emailConfirm: { on, deliverable, waiting,
 * sentToday, dayBudget, failedLast24h, refusedLast24h }`.
 *
 * `{ ebayLocalMarkets: boolean }` is the per-country eBay switch (settings key
 * ebay_local_markets, only the exact "1" is on; default off). GET carries
 * `ebayLocalMarkets: boolean`. Increment 1 of the plan only stores it: nothing
 * routes a seller to a local marketplace yet.
 */
async function allSwitches() {
  const games: Record<string, boolean> = {};
  for (const g of GATED_GAMES) games[g] = await gamePublic(g);
  return { magicPublic: games.mtg, games, emailConfirm: await emailConfirmStats(), ebayLocalMarkets: await ebayLocalMarketsOn() };
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
    const emailFlip = typeof body?.emailConfirm === "boolean" ? (body.emailConfirm as boolean) : null;
    const localFlip = typeof body?.ebayLocalMarkets === "boolean" ? (body.ebayLocalMarkets as boolean) : null;
    if (flips.length === 0 && emailFlip === null && localFlip === null) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    if (emailFlip === true && !emailConfirmActive()) {
      return NextResponse.json({ error: "Email isn't set up on this server, so codes can't be sent" }, { status: 400 });
    }
    for (const [g, on] of flips) await setSetting(gamePublicKey(g), on ? "1" : "0");
    if (localFlip !== null) await setSetting(EBAY_LOCAL_MARKETS_KEY, localFlip ? "1" : "0");
    let released = 0;
    if (emailFlip !== null) {
      await setSetting(EMAIL_CONFIRM_KEY, emailFlip ? "1" : "0");
      // Off is also the kill switch: nobody stays walled behind a broken mailbox.
      if (!emailFlip) released = await releaseAllPending();
    }
    // The public pages (landing, /help, /terms, /privacy, metadata, OG image)
    // are statically cached — the landing for a day. Bust everything so the
    // flip is visible at once (09-05: Chris flipped it and the site kept
    // saying Magic).
    if (flips.length > 0) revalidatePath("/", "layout");
    return NextResponse.json({ ...(await allSwitches()), released });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("settings patch failed:", err);
    return NextResponse.json({ error: "Couldn't save the setting" }, { status: 500 });
  }
}
