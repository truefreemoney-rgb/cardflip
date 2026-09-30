import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { LIMITS, clientIp } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";
import { helpHistory } from "@/lib/server/helpChat";
import { TICKET_STATUS_LABEL, TicketInputError, TicketLimitError, listUserTickets, openTicket } from "@/lib/server/supportTickets";

/**
 * The robot's support tickets. Signed-in only. GET = mine (number, subject,
 * status), POST {subject?, message} = open one (mails support@ + a receipt).
 */

function unauthorized(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
  throw err;
}

function shape(t: { id: string; number: number; subject: string; status: "open" | "closed"; createdAt: number; updatedAt: number; closedAt: number | null }) {
  return { id: t.id, number: t.number, subject: t.subject, status: t.status, statusLabel: TICKET_STATUS_LABEL[t.status], createdAt: t.createdAt, updatedAt: t.updatedAt, closedAt: t.closedAt };
}

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ tickets: (await listUserTickets(user.id)).map(shape) });
  } catch (err) {
    return unauthorized(err);
  }
}

export async function POST(req: NextRequest) {
  // Shared counter, not per instance: every ticket mails the support inbox,
  // and an unconfirmed signup can open one too (Help stays open on the wall).
  const limited = await limitOrRespondAsync(`ticket:${clientIp(req)}`, LIMITS.supportTicket);
  if (limited) return limited;
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const message = typeof body?.message === "string" ? body.message : "";
    const subject = typeof body?.subject === "string" ? body.subject : "";
    try {
      const transcript = (await helpHistory(user.id, 8)).map((m) => ({ role: m.role, content: m.content }));
      const ticket = await openTicket(user, { subject, body: message, images: body?.images }, transcript);
      return NextResponse.json({ ticket: shape(ticket) }, { status: 201 });
    } catch (err) {
      if (err instanceof TicketInputError) return NextResponse.json({ error: err.message }, { status: 400 });
      if (err instanceof TicketLimitError) return NextResponse.json({ error: err.message }, { status: 429 });
      throw err;
    }
  } catch (err) {
    return unauthorized(err);
  }
}
