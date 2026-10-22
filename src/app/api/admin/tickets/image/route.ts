import { NextRequest } from "next/server";
import { requireAdminOwner } from "@/lib/server/auth";
import { uploadTicketImage } from "@/lib/server/ticketImage";
import { adminFailure } from "@/lib/server/adminGate";

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
    return adminFailure(err);
  }
}
