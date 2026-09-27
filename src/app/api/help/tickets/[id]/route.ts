import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { TICKET_STATUS_LABEL, getUserTicket } from "@/lib/server/supportTickets";

/** One of the seller's own tickets in full: what they sent, photos, notes. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const t = await getUserTicket(user.id, id);
    if (!t) return NextResponse.json({ error: "No such ticket" }, { status: 404 });
    return NextResponse.json({
      ticket: {
        id: t.id,
        number: t.number,
        subject: t.subject,
        body: t.body,
        images: t.images,
        status: t.status,
        statusLabel: TICKET_STATUS_LABEL[t.status],
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        closedAt: t.closedAt,
        notes: t.notes.map((n) => ({ id: n.id, author: n.author, body: n.body, images: n.images, createdAt: n.createdAt })),
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}
