import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { LIMITS, clientIp } from "@/lib/server/rateLimit";
import { CODE_MAX_ATTEMPTS, cleanCode, confirmWithCode, limitWithMessage, nothingWaiting, publicUserWithEmailState } from "@/lib/server/emailVerify";
import { findUserById, needsEmailConfirm } from "@/lib/server/users";

/**
 * Email confirmation, the typed-code half (emailVerify.ts). Signed in only:
 * the installed app is already signed in when the code arrives, so nothing
 * has to move between apps.
 *
 *   GET  — is this account still walled? A cheap poll for the wall (the link
 *          in the email confirms from another browser, and the app notices).
 *   POST { code } — confirm. Six digits; spaces and text around them are
 *          ignored. 200 { ok, user }; 400 wrong_code / too_many / expired;
 *          409 email_taken; 429 slow_down. Already confirmed (by the link, a
 *          reset, another tab) is 200 { ok, alreadyConfirmed, user }, so a
 *          stale screen just clears. An email change whose code ran out is NOT
 *          "already confirmed" (users.email never moved): that is 400 expired.
 */

function unauthorized(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
  throw err;
}

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ pending: needsEmailConfirm(user), user: await publicUserWithEmailState(user) });
  } catch (err) {
    return unauthorized(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    // Done already (or nothing waiting): say so before any limit or code check.
    if (await nothingWaiting(user)) {
      return NextResponse.json({ ok: true, alreadyConfirmed: true, user: await publicUserWithEmailState(user) });
    }
    const limited = await limitWithMessage([
      [`auth:verify:${clientIp(req)}`, LIMITS.authAttempt],
      [`auth:verify:acct:${user.id}`, LIMITS.authAccount],
    ]);
    if (limited) return limited;
    const body = await req.json().catch(() => null);
    const code = cleanCode(body?.code);
    if (!code) {
      return NextResponse.json({ error: "invalid_code", message: "Enter the 6-digit code." }, { status: 400 });
    }

    const result = await confirmWithCode(user.id, code);
    switch (result.state) {
      case "confirmed":
        return NextResponse.json({ ok: true, wasPending: result.wasPending, user: await publicUserWithEmailState(result.user) });
      case "wrong": {
        if (result.triesLeft <= 0) {
          return NextResponse.json({ error: "too_many", message: "Too many tries. Tap Send a New Code.", triesLeft: 0 }, { status: 400 });
        }
        const n = result.triesLeft;
        return NextResponse.json(
          { error: "wrong_code", message: `That code isn't right. ${n} ${n === 1 ? "try" : "tries"} left.`, triesLeft: n, maxTries: CODE_MAX_ATTEMPTS },
          { status: 400 },
        );
      }
      case "taken":
        return NextResponse.json({ error: "email_taken", message: "That email is already in use" }, { status: 409 });
    }
    // Nothing usable left. If the link (or a reset, or another tab) just let
    // this account in, say that instead of "expired".
    const now = await findUserById(user.id);
    if (now && (await nothingWaiting(now))) {
      return NextResponse.json({ ok: true, alreadyConfirmed: true, user: await publicUserWithEmailState(now) });
    }
    if (result.state === "too_many") {
      return NextResponse.json({ error: "too_many", message: "Too many tries. Tap Send a New Code.", triesLeft: 0 }, { status: 400 });
    }
    // expired, or a code for an address the account has since left
    return NextResponse.json({ error: "expired", message: "That code has expired. Tap Send a New Code." }, { status: 400 });
  } catch (err) {
    return unauthorized(err);
  }
}
