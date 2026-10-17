import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { LIMITS, clientIp } from "@/lib/server/rateLimit";
import { limitOrRespondShared } from "@/lib/server/rateLimitDb";
import { uploadTicketImage } from "@/lib/server/ticketImage";

/** Photos on a support ticket or a seller's note: see lib/server/ticketImage.ts. */
export async function POST(req: NextRequest) {
  const limited = await limitOrRespondShared(`ticketimage:${clientIp(req)}`, LIMITS.supportImage);
  if (limited) return limited;
  try {
    await requireUser();
    return await uploadTicketImage(req);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}
