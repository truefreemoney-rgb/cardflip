import { NextRequest, NextResponse } from "next/server";
import { requireAdminOwner } from "@/lib/server/auth";
import { getTicketThread, setTicketStatus } from "@/lib/server/supportTickets";
import { adminFailure } from "@/lib/server/adminGate";

/** Admin: one ticket with its whole chat (refreshed when the thread opens). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminOwner();
    const { id } = await ctx.params;
    const ticket = await getTicketThread(id);
    if (!ticket) return NextResponse.json({ error: "No such ticket" }, { status: 404 });
    return NextResponse.json({ ticket });
  } catch (err) {
    return adminFailure(err);
  }
}

/** Admin: PATCH {status: "open" | "closed"}. Closing mails the seller. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminOwner();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const status = body?.status === "closed" ? "closed" : body?.status === "open" ? "open" : null;
    if (!status) return NextResponse.json({ error: "status must be open or closed" }, { status: 400 });
    const ticket = await setTicketStatus(id, status);
    if (!ticket) return NextResponse.json({ error: "No such ticket" }, { status: 404 });
    return NextResponse.json({ ticket });
  } catch (err) {
    return adminFailure(err);
  }
}
