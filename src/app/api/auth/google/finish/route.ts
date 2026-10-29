import { NextResponse } from "next/server";
import { GOOGLE_FAIL_MESSAGE } from "@/lib/googleAuth";
import { isAppRequest } from "@/lib/server/appSession";
import { openAppTicket } from "@/lib/server/googleAuth";
import { ipGate } from "@/lib/server/rateLimitDb";
import { getSessionUserId } from "@/lib/server/sessions";
import { findUserById, toPublicUser } from "@/lib/server/users";

/**
 * "Continue with Google" from the iPhone app, the last step (10-29). The browser sheet came back
 * to the app with ?ticket=… (api/auth/google/callback); the app POSTs { ticket, verifier } and
 * gets the login route's answer, { user, session: { token, expiresAt } }, for the session the
 * callback already opened. The ticket opens only with the PKCE verifier the app minted for that
 * one request and only for two minutes, so a ticket seen in transit is worthless on its own.
 */
export async function POST(req: Request) {
  if (!isAppRequest(req)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const limited = await ipGate(req, "auth:google:finish");
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object") throw new Error("not an object");
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const ticket = typeof body.ticket === "string" ? body.ticket : "";
  const verifier = typeof body.verifier === "string" ? body.verifier : "";
  const session = openAppTicket(ticket, verifier);
  if (!session) return NextResponse.json({ error: GOOGLE_FAIL_MESSAGE }, { status: 401 });

  // The callback made the session seconds ago; it being gone means a sign-out raced it, and the answer is the same.
  const userId = await getSessionUserId(session.token);
  const user = userId ? await findUserById(userId) : null;
  if (!user) return NextResponse.json({ error: GOOGLE_FAIL_MESSAGE }, { status: 401 });
  return NextResponse.json({ user: toPublicUser(user), session });
}
