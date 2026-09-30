import { NextResponse } from "next/server";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";
import { consumeLink, limitWithMessage, peekLink } from "@/lib/server/emailVerify";

/**
 * The Confirm Email button in the mail (emailVerify.ts). Works with no
 * session, like the digest unsubscribe: mail opens links in Safari, which has
 * its own cookie jar apart from the installed app. It NEVER signs anyone in
 * and never touches a session or a cookie (a reset link does both).
 *
 * GET ?t=   — a peek, safe for a mail scanner's prefetch. Always 200
 *             { state, email } with state valid | confirmed | replaced |
 *             expired, and the address masked ("s***@example.com").
 * POST {t}  — confirm, from the button on the page. 200 { ok, state:
 *             "confirmed", already, email }; opening the link again after
 *             the code (or twice) is a 200 with already: true. 400 for a
 *             replaced or expired link; 409 if the address got taken.
 */

const MESSAGES = {
  replaced: "This link was replaced by a newer email. Use the newest one.",
  expired: "This link has expired. Open CardFlip and tap Send a New Code.",
} as const;

export async function GET(req: Request) {
  const limited = limitOrRespond(`auth:confirm:peek:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const peek = token ? await peekLink(token) : { state: "expired" as const, email: null };
  return NextResponse.json(peek);
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
      return NextResponse.json({ ok: true, state: "confirmed", already: result.already, email: result.email });
    case "taken":
      return NextResponse.json({ error: "email_taken", state: "taken", message: "That email is already in use" }, { status: 409 });
    case "replaced":
      return NextResponse.json({ error: "replaced", state: "replaced", message: MESSAGES.replaced }, { status: 400 });
    default: // expired, or the account moved on
      return NextResponse.json({ error: "expired", state: "expired", message: MESSAGES.expired }, { status: 400 });
  }
}
