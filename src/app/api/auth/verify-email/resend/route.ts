import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { LIMITS, clientIp, type RateLimitRule } from "@/lib/server/rateLimit";
import {
  RESEND_COOLDOWN_SECONDS,
  checkNewEmail,
  lastChangeAttempt,
  limitCodeMail,
  limitWithMessage,
  pendingEmailChange,
  publicUserWithEmailState,
  sendChangeCode,
  sendWalledCode,
} from "@/lib/server/emailVerify";
import { findUserById, needsEmailConfirm } from "@/lib/server/users";

/**
 * POST { email? } — mail a code.
 *
 *  - Walled account, no body: a fresh code to users.email. The code and link
 *    already in the inbox keep working (a resend never kills them).
 *  - Walled account, { email }: Change Email. That address was never proven,
 *    so it is saved now (login, this screen and the next resend all agree)
 *    and the wall stays until it is confirmed. 400 for a bad or throwaway
 *    address, 409 if it is taken. No password needed.
 *  - Established account with an email change waiting (PATCH /api/account):
 *    the code goes to that new address again, also after the first code ran
 *    out (a lapsed change is still a change). { email } is refused here
 *    (400 use_account): changing a real account's email needs its password.
 *  - Nothing to confirm: 200 { alreadyConfirmed } so a stale screen clears.
 *
 * 200 { ok, sent, user, emailCodeExpiresAt, cooldownSeconds }. When the mail
 * server is down the wall lifts instead: 200 { sent: false, released: true }.
 * 400 recipient_refused keeps the wall (fix the address). 429 slow_down: one
 * code per 30 s and five an hour per account, and per target address, and
 * thirty a day per network.
 *
 * Order matters for Change Email: the network's limit (and a per-account cap
 * on tries) comes BEFORE the "already in use" check, which is otherwise a
 * free way to ask whether an address has an account.
 */

function unauthorized(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
  throw err;
}

const REFUSED = "That address didn't accept our email. Check it and tap Change Email.";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const asked = typeof body?.email === "string" && body.email.trim() !== "" ? body.email : null;
    const walled = needsEmailConfirm(user);

    const ipRule: [string, RateLimitRule[]] = [`auth:code:${clientIp(req)}`, LIMITS.authAttempt];
    let ipCounted = false;
    let target = user.email;
    if (!walled) {
      if (asked !== null) {
        return NextResponse.json({ error: "use_account", message: "Change your email from your account page." }, { status: 400 });
      }
      // A change whose code has run out is still a change: send a new code to
      // that address rather than telling a stale screen it went through.
      const change = (await pendingEmailChange(user)) ?? (await lastChangeAttempt(user));
      if (!change) return NextResponse.json({ ok: true, alreadyConfirmed: true, user: await publicUserWithEmailState(user) });
      target = change.email;
    } else if (asked !== null) {
      const probed = await limitWithMessage([ipRule, [`auth:code:probe:${user.id}`, LIMITS.authAccount]]);
      if (probed) return probed;
      ipCounted = true;
      const checked = await checkNewEmail(asked, user);
      if ("status" in checked) return NextResponse.json({ error: checked.error, message: checked.message }, { status: checked.status });
      target = checked.email;
    }

    const limited = await limitWithMessage([
      ...(ipCounted ? [] : [ipRule]),
      [`auth:code:acct:${user.id}`, LIMITS.emailCode],
      [`auth:code:to:${target}`, LIMITS.emailCode],
    ]);
    if (limited) return limited;
    const dayLimited = await limitCodeMail(req);
    if (dayLimited) return dayLimited;

    if (!walled) {
      const sent = await sendChangeCode(user, target);
      if (!sent.ok) return NextResponse.json({ error: sent.error, message: sent.message }, { status: sent.status });
      return NextResponse.json({
        ok: true,
        sent: true,
        pendingEmail: sent.email,
        emailCodeExpiresAt: sent.expiresAt,
        cooldownSeconds: RESEND_COOLDOWN_SECONDS,
        user: await publicUserWithEmailState(user),
      });
    }

    const out = await sendWalledCode(user, target);
    if (out.kind === "problem") {
      return NextResponse.json({ error: out.problem.error, message: out.problem.message }, { status: out.problem.status });
    }
    const fresh = (await findUserById(user.id)) ?? user;
    if (out.kind === "refused") {
      return NextResponse.json({ error: "recipient_refused", message: REFUSED, user: await publicUserWithEmailState(fresh) }, { status: 400 });
    }
    // Released: our mail is down, not their address, so they are let in rather than stranded.
    if (out.kind === "released") {
      return NextResponse.json({ ok: true, sent: false, released: true, user: await publicUserWithEmailState(fresh) });
    }
    return NextResponse.json({
      ok: true,
      sent: true,
      emailCodeExpiresAt: out.expiresAt,
      cooldownSeconds: RESEND_COOLDOWN_SECONDS,
      user: await publicUserWithEmailState(fresh),
    });
  } catch (err) {
    return unauthorized(err);
  }
}
