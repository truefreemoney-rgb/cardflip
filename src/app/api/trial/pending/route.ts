import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AuthError, requireUser } from "@/lib/server/auth";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";

/**
 * The card scanned on /scan before signup, held on the server (10-05). Ad
 * visitors sign up inside TikTok's in-app browser, then open the confirm link
 * in a normal one: localStorage does not travel between the two, this does.
 * Needs a session but works for an account still waiting on its email (that is
 * exactly when it is written). One row per account; the client deletes it once
 * the card is in Inventory (claimPendingScan).
 *
 *   POST { input, photo? } — keep it. The photo is a data URL, dropped (card
 *                            kept) when it is over 600 KB.
 *   GET                    — { pending: { input, photo, at } | null }
 *   DELETE                 — forget it.
 */

const MAX_PHOTO_CHARS = 600_000;
const MAX_INPUT_CHARS = 8_000;
const MAX_BODY_CHARS = 700_000 + MAX_INPUT_CHARS;

function unauthorized(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
  throw err;
}

export async function GET() {
  try {
    const user = await requireUser();
    const row = await db
      .prepare("SELECT input, photo, at FROM pending_scans WHERE user_id = ?")
      .get<{ input: string; photo: string | null; at: number }>(user.id);
    if (!row) return NextResponse.json({ pending: null });
    let input: unknown = null;
    try {
      input = JSON.parse(row.input);
    } catch {
      input = null;
    }
    return NextResponse.json({ pending: input ? { input, photo: row.photo, at: Number(row.at) } : null });
  } catch (err) {
    return unauthorized(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const limited = limitOrRespond(`trial:pending:${clientIp(req)}`, LIMITS.authAttempt);
    if (limited) return limited;
    const raw = await req.text();
    if (raw.length > MAX_BODY_CHARS) return NextResponse.json({ error: "Too large" }, { status: 413 });
    let body: { input?: unknown; photo?: unknown } | null = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    const input = body?.input as { cardName?: unknown } | undefined;
    if (!input || typeof input !== "object" || typeof input.cardName !== "string" || !input.cardName.trim()) {
      return NextResponse.json({ error: "No card" }, { status: 400 });
    }
    const inputJson = JSON.stringify(input);
    if (inputJson.length > MAX_INPUT_CHARS) return NextResponse.json({ error: "Too large" }, { status: 413 });
    const photo = typeof body?.photo === "string" && body.photo.startsWith("data:image/") && body.photo.length <= MAX_PHOTO_CHARS ? body.photo : null;
    await db
      .prepare(
        `INSERT INTO pending_scans (user_id, input, photo, at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET input = excluded.input, photo = excluded.photo, at = excluded.at`,
      )
      .run(user.id, inputJson, photo, Date.now());
    return NextResponse.json({ ok: true, photoKept: photo !== null });
  } catch (err) {
    return unauthorized(err);
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    await db.prepare("DELETE FROM pending_scans WHERE user_id = ?").run(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return unauthorized(err);
  }
}
