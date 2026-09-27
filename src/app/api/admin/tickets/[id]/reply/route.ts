import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { TicketInputError, replyToTicket } from "@/lib/server/supportTickets";

/** Admin: POST {message?, images?} = reply on the ticket's chat; mails the seller. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminOwner();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const message = typeof body?.message === "string" ? body.message : "";
    try {
      const note = await replyToTicket(id, { body: message, images: body?.images });
      if (!note) return NextResponse.json({ error: "No such ticket" }, { status: 404 });
      return NextResponse.json({ note }, { status: 201 });
    } catch (err) {
      if (err instanceof TicketInputError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}
