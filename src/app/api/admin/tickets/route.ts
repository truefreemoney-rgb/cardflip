import { NextResponse } from "next/server";
import { requireAdminOwner } from "@/lib/server/auth";
import { listAllTickets } from "@/lib/server/supportTickets";
import { adminFailure } from "@/lib/server/adminGate";

/** Admin: every support ticket, open first. */
export async function GET() {
  try {
    await requireAdminOwner();
    return NextResponse.json({ tickets: await listAllTickets() });
  } catch (err) {
    return adminFailure(err);
  }
}
