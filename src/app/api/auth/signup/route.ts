import { NextResponse } from "next/server";
import { TRIAL_SCANS, createUser, findUserByEmail, needsEmailConfirm, totpEnabled, trialScansLeft, type User } from "@/lib/server/users";
import { createSession, sessionCookieOptions } from "@/lib/server/sessions";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { verifyPassword } from "@/lib/server/password";
import { passwordProblem } from "@/lib/passwordRules";
import { LIMITS, clientIp } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";
import { attachReferral } from "@/lib/server/referrals";
import { isMailConfigured, sendSignupWelcomeEmail } from "@/lib/server/mail";
import {
  afterResponse,
  emailConfirmEnabled,
  limitCodeMail,
  limitWithMessage,
  liveVerification,
  publicUserWithEmailState,
  startSignupConfirmation,
} from "@/lib/server/emailVerify";
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_MAX_AGE,
  countryFrom,
  deviceIdFrom,
  hashIp,
  isDisposableEmail,
  newDeviceId,
  recordSignup,
  repeatSignup,
} from "@/lib/server/signupGuard";
import { isValidEmail } from "@/lib/emailAddress";
import { parseTouch } from "@/lib/attribution";
import { setHomeCookie } from "@/lib/homeCookie";

/**
 * A signup that comes back for an account still waiting on its email code,
 * with the same password (the response was lost, or Back and Create Account
 * again): sign in and pick up where it left off, not a dead-end "already
 * exists". A fresh code is mailed unless one just went out. Never for an
 * account with two-step verification on: this sign-in checks the password
 * alone, so those get the usual 409 and log in normally, code and all.
 */
async function resumeSignup(existing: User, req: Request) {
  const session = await createSession(existing.id);
  // A gap or a spent day's allowance means no new code now (one may be on its way already).
  const gap =
    (await limitWithMessage([
      [`auth:code:acct:${existing.id}`, LIMITS.emailCode],
      [`auth:code:to:${existing.email}`, LIMITS.emailCode],
    ])) ?? (await limitCodeMail(req));
  const live = await liveVerification(existing.id);
  const conf = gap
    ? { user: existing, emailSent: Boolean(live), problem: null }
    : await startSignupConfirmation(existing);
  const res = NextResponse.json({
    user: await publicUserWithEmailState(conf.user),
    emailSent: conf.emailSent,
    emailProblem: conf.problem,
    resumed: true,
  });
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  setHomeCookie(res, existing.id, existing.homeCountry, session.token);
  return res;
}

export async function POST(req: Request) {
  // Brute-force backstop, per IP. Shared counter, not per instance: signup
  // now mails a code to whatever address was typed.
  const limited = await limitOrRespondAsync(`auth:signup:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  // Same cap as admin create and account PATCH.
  if (name.length > 80) {
    return NextResponse.json({ error: "Name must be 80 characters or fewer." }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  const pwProblem = passwordProblem(password);
  if (pwProblem) {
    return NextResponse.json({ error: pwProblem }, { status: 400 });
  }

  if (isDisposableEmail(email)) {
    return NextResponse.json({ error: "Please use your real email address." }, { status: 400 });
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    if (needsEmailConfirm(existing) && !totpEnabled(existing)) {
      // Same lock as login, so this is not a way around its guess limit.
      const locked = await limitOrRespondAsync(`auth:login:acct:${email.toLowerCase()}`, LIMITS.authAccount);
      if (locked) return locked;
      if (verifyPassword(password, existing.passwordHash)) return resumeSignup(existing, req);
    }
    return NextResponse.json(
      { error: "An account with that email already exists." },
      { status: 409 },
    );
  }

  // Free scans once per IP and per device (Chris 09-29).
  const ipHash = hashIp(clientIp(req));
  const knownDevice = deviceIdFrom(req);
  const deviceId = knownDevice ?? newDeviceId();
  const repeat = Boolean(await repeatSignup(ipHash, knownDevice));

  // Email confirmation is on only while the admin switch says exactly "1"
  // AND a code can actually be delivered (emailVerify.ts). Off = today.
  const confirm = await emailConfirmEnabled();
  if (confirm) {
    // A code is about to be mailed to whatever address was typed: cap it per
    // network per day (so one script cannot spend the day's shared mail budget
    // and lift the wall for everyone) and per address (so a signup, delete and
    // sign-up-again loop is not a way to mail a stranger). The same address key
    // as Send a New Code, so the two share one 30-second gap.
    const mailLimited =
      (await limitCodeMail(req)) ?? (await limitWithMessage([[`auth:code:to:${email.toLowerCase()}`, LIMITS.emailCode]]));
    if (mailLimited) return mailLimited;
  }
  // Home country = where the account is made (Chris 09-30 travel rule); the proxy
  // already refused signups from outside the open countries.
  const created = await createUser(name, email, password, "user", { emailPending: confirm, homeCountry: countryFrom(req) });
  // The first touch the browser kept (lib/attribution.ts); malformed = dropped, never an error.
  await recordSignup(created.id, ipHash, deviceId, repeat, countryFrom(req), Date.now(), parseTouch(body?.touch));
  let user: User = repeat ? { ...created, trialScansUsed: TRIAL_SCANS } : created;
  // Invite a friend: ?ref=CODE captured on the landing page rides along.
  // Best effort — a bad or stale code never blocks the signup.
  if (typeof body?.ref === "string" && body.ref) await attachReferral(user.id, body.ref).catch(() => {});
  const session = await createSession(user.id);
  let emailSent = false;
  let emailProblem: "recipient" | null = null;
  if (confirm) {
    // The code goes out now; the welcome waits for the confirmed inbox. The
    // account is fully created first and the send is bounded, so a slow or
    // broken mail server can neither orphan the account behind a timed-out
    // request nor strand it behind a wall (a failure releases it and reports).
    const conf = await startSignupConfirmation(user);
    user = conf.user;
    emailSent = conf.emailSent;
    emailProblem = conf.problem;
  } else if (isMailConfigured()) {
    // Welcome mail (Chris, 09-25). Sent after the response: Vercel keeps the
    // function alive until it finishes (so it is not frozen mid-send), the
    // phone is not held for it, and it never fails the signup.
    const welcomeTo = user.email;
    const welcomeName = name.split(" ")[0];
    const welcomeLeft = trialScansLeft(user);
    await afterResponse(async () => {
      try {
        await sendSignupWelcomeEmail(welcomeTo, welcomeName, welcomeLeft);
      } catch (err) {
        console.error(`signup: welcome email to ${welcomeTo} failed:`, err);
      }
    });
  }

  const res = NextResponse.json({ user: await publicUserWithEmailState(user), emailSent, emailProblem }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  setHomeCookie(res, user.id, user.homeCountry, session.token);
  res.cookies.set(DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE,
  });
  return res;
}
