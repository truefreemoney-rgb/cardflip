import { NextResponse } from "next/server";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";
import { consumeLink, limitWithMessage, peekLink } from "@/lib/server/emailVerify";
import { createSession, sessionCookieOptions } from "@/lib/server/sessions";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { findUserById } from "@/lib/server/users";
import { setHomeCookie } from "@/lib/homeCookie";

/**
 * The Confirm button in the mail (emailVerify.ts). Works with no session, like
 * the digest unsubscribe: mail opens links in a normal browser, which has its
 * own cookie jar apart from the in-app browser the person signed up in.
 *
 * Signs in (10-05): ad visitors sign up inside TikTok's browser, where the
 * camera cannot run, and confirming must land them in a real browser already
 * signed in. So a POST that FRESHLY lifts a signup wall creates a session and
 * sets the cookie exactly like login does, and answers signedIn: true. A link
 * reopened within 15 minutes of its first use still signs in (a mail scanner
 * that runs scripts may confirm first); after that it signs nobody in, or the
 * mail would be a reusable login. An
 * email-change link on an established account does not sign in either.
 *
 * GET ?t=   — a peek, safe for a mail scanner's prefetch. Always 200
 *             { state, email } with state valid | confirmed | replaced |
 *             expired, and the address masked ("s***@example.com").
 * POST {t}  — confirm, from the button on the page. 200 { ok, state:
 *             "confirmed", already, email, signedIn }; opening the link again after
 *             the code (or twice) is a 200 with already: true. 400 for a
 *             replaced or expired link; 409 if the address got taken.
 */

const MESSAGES = {
  replaced: "This link was replaced by a newer email. Use the newest one.",
  expired: "This link has expired. Open CardFlip and tap Send a new link.",
} as const;

export async function GET(req: Request) {
  const limited = limitOrRespond(`auth:confirm:peek:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const peek = token ? await peekLink(token) : { state: "expired" as const, email: null };
  return NextResponse.json(peek);
}

async function confirmed(result: Extract<Awaited<ReturnType<typeof consumeLink>>, { state: "confirmed" }>) {
  const body = { ok: true, state: "confirmed", already: result.already, email: result.email };
  const user = result.signIn ? await findUserById(result.userId) : null;
  if (!user) return NextResponse.json({ ...body, signedIn: false });
  const session = await createSession(user.id);
  const res = NextResponse.json({ ...body, signedIn: true });
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  setHomeCookie(res, user.id, user.homeCountry, session.token);
  return res;
}

export async function POST(req: Request) {
  const limited = await limitWithMessage([[`auth:confirm:${clientIp(req)}`, LIMITS.authAttempt]]);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  const token = typeof body?.t === "string" ? body.t : "";
  if (!token) {
    return NextResponse.json({ error: "invalid", state: "expired", message: MESSAGES.expired }, { status: 400 });
  }
  const result = await consumeLink(token);
  switch (result.state) {
    case "confirmed":
      return await confirmed(result);
    case "taken":
      return NextResponse.json({ error: "email_taken", state: "taken", message: "That email is already in use" }, { status: 409 });
    case "replaced":
      return NextResponse.json({ error: "replaced", state: "replaced", message: MESSAGES.replaced }, { status: 400 });
    default: // expired, or the account moved on
      return NextResponse.json({ error: "expired", state: "expired", message: MESSAGES.expired }, { status: 400 });
  }
}
