import { NextResponse } from "next/server";
import { findUserByEmail, setTotpBackupCodes, toPublicUser, totpEnabled } from "@/lib/server/users";
import { hashBackupCode, verifyTotp } from "@/lib/server/totp";
import { hashPassword, verifyPassword } from "@/lib/server/password";
import { createSession, sessionCookieOptions } from "@/lib/server/sessions";

let dummy: string | null = null;
/** A real scrypt hash of nothing anyone types, made once per instance. */
function dummyHash(): string {
  dummy ??= hashPassword(`no-account-${Math.random()}`);
  return dummy;
}
import { SESSION_COOKIE } from "@/lib/server/auth";
import { LIMITS, clientIp } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";
import { countryFrom } from "@/lib/server/signupGuard";
import { isAllowedCountry } from "@/lib/countries";
import { setHomeCookie } from "@/lib/homeCookie";

export async function POST(req: Request) {
  // Brute-force backstop, per IP.
  const limited = await limitOrRespondAsync(`auth:login:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  let email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  // Dev/test convenience (Chris, 08-26): typing just "admin" signs into the
  // admin account without the email dance. Any other input is an email.
  // Never on the live site (10-01 sweep): that account skips two-step and is unlimited.
  if (email.toLowerCase() === "admin" && process.env.VERCEL_ENV !== "production") email = "admin@cardflip.dev";

  // Per-account lockout on top of the IP one: rotating IPs against a single
  // email still stops at 10 tries per 15 minutes.
  if (email) {
    const locked = await limitOrRespondAsync(`auth:login:acct:${email.toLowerCase()}`, LIMITS.authAccount);
    if (locked) return locked;
  }

  const user = email ? await findUserByEmail(email) : null;

  // Same message whether the email is unknown or the password is wrong, so
  // a login attempt can't be used to enumerate registered accounts.
  // An unknown email still pays for one hash (10-01 sweep): skipping scrypt made it answer measurably faster.
  if (!user) verifyPassword(password, dummyHash());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json(
      { error: "Incorrect email or password." },
      { status: 401 },
    );
  }

  // Two-step: the password alone doesn't sign in — the client re-submits the
  // same credentials with the 6-digit authenticator code once prompted.
  // Stateless on purpose (no pending-login token to store or expire); the
  // per-IP limiter above is the brute-force backstop for codes too.
  // Admins skip it (Chris, 08-26: dev-test accounts shouldn't need a phone).
  if (user.role !== "admin" && totpEnabled(user)) {
    const code = typeof body?.code === "string" ? body.code : "";
    if (!code) {
      return NextResponse.json({ totpRequired: true, error: "Enter your authenticator code." }, { status: 401 });
    }
    if (!verifyTotp(user.totpSecret!, code)) {
      // A backup code (09-04) works once, then it's gone.
      const idx = code.length >= 8 ? user.totpBackupCodes.indexOf(hashBackupCode(code)) : -1;
      if (idx < 0) {
        return NextResponse.json({ totpRequired: true, error: "That code didn't match. Codes change every 30 seconds — try the current one, or a backup code." }, { status: 401 });
      }
      await setTotpBackupCodes(user.id, user.totpBackupCodes.filter((_, i) => i !== idx));
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
