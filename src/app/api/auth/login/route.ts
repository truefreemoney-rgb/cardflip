import { NextResponse } from "next/server";
import { acceptTotpStep, findUserByEmail, spendTotpBackupCode, toPublicUser, totpEnabled } from "@/lib/server/users";
import { hashBackupCode, totpMatchStep } from "@/lib/server/totp";
import { hashPassword, verifyPassword } from "@/lib/server/password";
import { createSession, sessionCookieOptions } from "@/lib/server/sessions";

let dummy: string | null = null;
/** A real scrypt hash of nothing anyone types, made once per instance. */
function dummyHash(): string {
  dummy ??= hashPassword(`no-account-${Math.random()}`);
  return dummy;
}
import { SESSION_COOKIE } from "@/lib/server/auth";
import { LOGIN_FAILED_MESSAGE, hasPassword } from "@/lib/googleAuth";
import { clientIp } from "@/lib/server/rateLimit";
import { accountLockout, ipGate, noteGhostLogin } from "@/lib/server/rateLimitDb";
import { countryFrom } from "@/lib/server/signupGuard";
import { isAllowedCountry } from "@/lib/countries";
import { setHomeCookie } from "@/lib/homeCookie";
import { loginCodeRequired, sendLoginCode, spendLoginCode } from "@/lib/server/loginCode";
import { maskEmail } from "@/lib/server/emailVerify";

export async function POST(req: Request) {
  // Brute-force backstop, per IP.
  const limited = await ipGate(req, "auth:login");
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  let email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  // Dev/test convenience (Chris, 08-26): typing just "admin" signs into the
  // admin account without the email dance. Any other input is an email.
  // Never on the live site (10-01 sweep): that account skips two-step and is unlimited.
  if (email.toLowerCase() === "admin" && process.env.VERCEL_ENV !== "production") email = "admin@cardflip.dev";

  // Per-account lockout on top of the IP one (accountLockout: per account + IP, plus a looser account-wide cap).
  if (email) {
    const locked = await accountLockout("auth:login", email, clientIp(req));
    if (locked) return locked;
  }

  const user = email ? await findUserByEmail(email) : null;

  // One message for an unknown email, a wrong password and a Google/X-only account, so a login attempt can't be used
  // to learn which emails have accounts (#30, 10-16 audit: the Google-only answer gave it away). Every miss pays for
  // one hash (10-01 sweep: skipping scrypt made a miss answer measurably faster).
  const passwordOk = user && hasPassword(user.passwordHash) ? verifyPassword(password, user.passwordHash) : (verifyPassword(password, dummyHash()), false);
  if (!user || !passwordOk) {
    if (!user && email) await noteGhostLogin(clientIp(req), email);
    return NextResponse.json({ error: LOGIN_FAILED_MESSAGE }, { status: 401 });
  }

  // Two-step: the password alone doesn't sign in — the client re-submits the
  // same credentials with the 6-digit authenticator code once prompted.
  // Stateless on purpose (no pending-login token to store or expire); the
  // per-IP limiter above is the brute-force backstop for codes too.
  // Admins skip the authenticator (Chris, 08-26: dev-test accounts shouldn't need a phone)…
  const code = typeof body?.code === "string" ? body.code : "";
  if (await loginCodeRequired(user)) {
    // …but on the live site their password only gets a code mailed to the
    // account (Chris, 09-30, after the sweep: the strongest account had no second step).
    const where = maskEmail(user.email);
    if (!code) {
      const sent = await sendLoginCode(user);
      if (sent === "failed") {
        return NextResponse.json({ error: "We couldn't email your sign-in code. Try again in a minute." }, { status: 503 });
      }
      return NextResponse.json({ totpRequired: true, emailCode: true, error: `We emailed a 6-digit code to ${where}. It works for 10 minutes.` }, { status: 401 });
    }
    if (!(await spendLoginCode(user.id, code))) {
      return NextResponse.json({ totpRequired: true, emailCode: true, error: "That code didn't match or has expired. Check the newest email, or send a new code." }, { status: 401 });
    }
  } else if (user.role !== "admin" && totpEnabled(user)) {
    if (!code) {
      return NextResponse.json({ totpRequired: true, error: "Enter your authenticator code." }, { status: 401 });
    }
    const step = totpMatchStep(user.totpSecret!, code);
    if (step !== null) {
      // An authenticator code works once (10-01 sweep).
      if (!(await acceptTotpStep(user.id, step))) {
        return NextResponse.json({ totpRequired: true, error: "That code was already used. Wait for your app to show the next one." }, { status: 401 });
      }
    } else if (!(code.length >= 8 && (await spendTotpBackupCode(user.id, hashBackupCode(code))))) {
      // A backup code (09-04) works once, then it's gone.
      return NextResponse.json({ totpRequired: true, error: "That code didn't match. Codes change every 30 seconds — try the current one, or a backup code." }, { status: 401 });
    }
  }

  // Travel rule (Chris 09-30): from outside the open countries, only an
  // account created inside them (or a legacy one with no recorded home) gets in.
  const here = countryFrom(req);
  if (here && !isAllowedCountry(here) && user.homeCountry && !isAllowedCountry(user.homeCountry)) {
    return NextResponse.json(
      { error: "CardFlip isn't available in your country yet.", unavailable: true },
      { status: 403 },
    );
  }

  const session = await createSession(user.id);
  const res = NextResponse.json({ user: toPublicUser(user) });
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  setHomeCookie(res, user.id, user.homeCountry, session.token);
  return res;
}
