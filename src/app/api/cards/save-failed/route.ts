import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { logSaveFailed } from "@/lib/server/cards";
import { parseGame } from "@/lib/games";

/**
 * The scanner showed a card but POST /api/cards never made a row, twice (10-14: Jenny's 5 trial scans
 * and 4 cards had no trail). One card_removals row with how = 'save-failed' so the admin console can
 * say "1 save failed" next to the scans-used line. Nothing else changes; always 200 for a signed-in seller.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
    const cardName = str(body?.cardName, 200);
    if (!cardName) return NextResponse.json({ error: "cardName is required" }, { status: 400 });
    await logSaveFailed(user.id, {
      scanId: str(body?.scanId, 64),
      game: typeof body?.game === "string" ? parseGame(body.game) : null,
      cardName,
      setName: str(body?.setName, 200),
      cardNumber: str(body?.cardNumber, 40),
      catalogCardId: str(body?.catalogCardId, 80),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
