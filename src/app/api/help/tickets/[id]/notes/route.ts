import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";
import { TicketInputError, TicketLimitError, addTicketNote } from "@/lib/server/supportTickets";

/** POST {message?, images?} = the seller adds to their open ticket. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = limitOrRespond(`ticketnote:${clientIp(req)}`, LIMITS.supportNote);
  if (limited) return limited;
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const message = typeof body?.message === "string" ? body.message : "";
    try {
      const note = await addTicketNote(user, id, { body: message, images: body?.images });
      return NextResponse.json({ note: { id: note.id, author: note.author, body: note.body, images: note.images, createdAt: note.createdAt } }, { status: 201 });
    } catch (err) {
      if (err instanceof TicketInputError) return NextResponse.json({ error: err.message }, { status: 400 });
      if (err instanceof TicketLimitError) return NextResponse.json({ error: err.message }, { status: 429 });
      throw err;
    }
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}
