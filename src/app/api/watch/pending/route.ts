import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isGameId } from "@/lib/games";
import { AuthError, requireUser } from "@/lib/server/auth";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";

/**
 * "Watch this price" tapped while signed out, held on the server (10-08).
 * The card is parked in localStorage first (WatchPrice.tsx); that does not
 * travel from a private tab, or from TikTok's browser, to the one the confirm
 * link opens in, so the confirm screen parks it here too (pushPendingWatch).
 * One row per account; PendingWatch deletes it once the card is watched.
 *
 *   POST { game, id } — keep it.
 *   GET               — { pending: { game, id, at } | null }
 *   DELETE            — forget it.
 */

const MAX_ID_CHARS = 80;

function unauthorized(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
  throw err;
}

export async function GET() {
  try {
    const user = await requireUser();
    const row = await db
      .prepare("SELECT game, card_id, at FROM pending_watches WHERE user_id = ?")
      .get<{ game: string; card_id: string; at: number }>(user.id);
    return NextResponse.json({ pending: row ? { game: row.game, id: row.card_id, at: Number(row.at) } : null });
  } catch (err) {
    return unauthorized(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const limited = limitOrRespond(`watch:pending:${clientIp(req)}`, LIMITS.authAttempt);
    if (limited) return limited;
    let body: { game?: unknown; id?: unknown } | null = null;
    try {
      body = (await req.json()) as { game?: unknown; id?: unknown };
    } catch {
      body = null;
    }
    const game = body?.game;
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!isGameId(game) || !id || id.length > MAX_ID_CHARS) {
      return NextResponse.json({ error: "No card" }, { status: 400 });
    }
    await db
      .prepare(
        `INSERT INTO pending_watches (user_id, game, card_id, at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET game = excluded.game, card_id = excluded.card_id, at = excluded.at`,
      )
      .run(user.id, game, id, Date.now());
    return NextResponse.json({ ok: true });
  } catch (err) {
    return unauthorized(err);
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    await db.prepare("DELETE FROM pending_watches WHERE user_id = ?").run(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return unauthorized(err);
  }
}