import { NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { listAllTickets } from "@/lib/server/supportTickets";

/** Admin: every support ticket, open first. */
export async function GET() {
  try {
    await requireAdminOwner();
    return NextResponse.json({ tickets: await listAllTickets() });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}
