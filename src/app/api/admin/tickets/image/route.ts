import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { uploadTicketImage } from "@/lib/server/ticketImage";

/**
 * Photos on an admin reply (09-26). The admin panel has its own session, so
 * the seller upload route (requireUser) would refuse it. Same store, same
 * tickets/ folder, so the ticket module accepts the URL.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdminOwner();
    return await uploadTicketImage(req);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}
