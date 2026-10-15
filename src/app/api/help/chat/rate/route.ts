import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { rateHelpMessage } from "@/lib/server/helpChat";

/**
 * Thumbs on a robot reply (10-14): POST {id, rating: 1 | -1 | 0}. Only the seller's own assistant
 * turns; 0 clears. /admin/robot reads the thumbs-down chats first.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id.slice(0, 80) : "";
    const rating = body?.rating === 1 || body?.rating === -1 || body?.rating === 0 ? (body.rating as 1 | -1 | 0) : null;
    if (!id || rating === null) return NextResponse.json({ error: "id and rating (1, -1 or 0) are required" }, { status: 400 });
    const ok = await rateHelpMessage(user.id, id, rating);
    if (!ok) return NextResponse.json({ error: "Not your message" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}
