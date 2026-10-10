import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { X_PENDING_COOKIE } from "@/lib/xAuth";
import { verifyXPending } from "@/lib/server/xAuth";
import { TRIAL_SCANS, createUser, findUserByEmail, findUserByXSub, trialScansLeft, type User } from "@/lib/server/users";
import { createSession, sessionCookieOptions } from "@/lib/server/sessions";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { LIMITS, clientIp } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";
import { attachReferral } from "@/lib/server/referrals";
import { isMailConfigured, sendSignupWelcomeEmail } from "@/lib/server/mail";
import {
  afterResponse,
  emailConfirmEnabled,
  limitCodeMail,
  limitWithMessage,
  startSignupConfirmation,
} from "@/lib/server/emailVerify";
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_MAX_AGE,
  countryFrom,
  deviceIdFrom,
  emailDomainTypo,
  hashIp,
  inboxKey,
  isDisposableEmail,
  newDeviceId,
  recordSignup,
  repeatSignup,
} from "@/lib/server/signupGuard";
import { isValidEmail } from "@/lib/emailAddress";
import { setHomeCookie } from "@/lib/homeCookie";

/**
 * "Continue with X", the last step when X did not share an email. The signed "x_pending" cookie
 * (made by the callback) says who they are on X; the typed email is NOT proven, so this goes through
 * the normal emailed-code confirmation exactly like the email signup. An email that already has an
 * account is refused: no linking without proof of the inbox.
 */
export async function POST(req: Request) {
  const limited = await limitOrRespondAsync(`auth:x:finish:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;

  const jar = await cookies();
  const pending = verifyXPending(jar.get(X_PENDING_COOKIE)?.value);
  if (!pending) {
    return NextResponse.json({ error: "That took too long. Tap Continue with X to start again." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  if (isDisposableEmail(email)) {
    return NextResponse.json({ error: "Please use your real email address." }, { status: 400 });
  }
  const fix = emailDomainTypo(email);
  if (fix) {
    return NextResponse.json({ error: `Check your email. Did you mean ${fix}?` }, { status: 400 });
  }
  if (await findUserByEmail(email)) {
    return NextResponse.json(
      { error: "That email already has an account. Log in with it instead." },
      { status: 409 },
    );
  }
  // Someone finished with this X account in the meantime (two tabs): not a second account.
  if (await findUserByXSub(pending.sub)) {
    return NextResponse.json({ error: "That X account is already signed up. Log in with X." }, { status: 409 });
  }

  // Same guards as the email signup route.
  const ipHash = hashIp(clientIp(req));
  const knownDevice = deviceIdFrom(req);
  const deviceId = knownDevice ?? newDeviceId();
  const inbox = inboxKey(email);
  const repeat = Boolean(await repeatSignup(ipHash, knownDevice, inbox));

  const confirm = await emailConfirmEnabled();
  if (confirm) {
    const mailLimited =
      (await limitCodeMail(req)) ?? (await limitWithMessage([[`auth:code:to:${email}`, LIMITS.emailCode]]));
    if (mailLimited) return mailLimited;
  }

  const here = countryFrom(req);
  let created: User;
  try {
    // The inbox is not proven here: no emailVerified. Pending while the confirmation switch is on.
    created = await createUser(pending.name || pending.username || "X user", email, "", "user", {
      emailPending: confirm,
      homeCountry: here,
      xSub: pending.sub,
    });
  } catch (err) {
    console.error("x finish: create failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Sign up failed. Try again." }, { status: 400 });
  }
  await recordSignup(created.id, ipHash, deviceId, repeat, here, Date.now(), pending.touch, inbox);
  let user: User = repeat ? { ...created, trialScansUsed: TRIAL_SCANS } : created;
  if (pending.ref) await attachReferral(user.id, pending.ref).catch(() => {});
  const session = await createSession(user.id);
  if (confirm) {
    // The code goes out now, exactly like the email signup (bounded, never strands the account).
    user = (await startSignupConfirmation(user)).user;
  } else if (isMailConfigured()) {
    const to = user.email;
    const first = user.name.split(" ")[0];
    const left = trialScansLeft(user);
    await afterResponse(async () => {
      try {
        await sendSignupWelcomeEmail(to, first, left);
      } catch (err) {
        console.error(`x signup: welcome email to ${to} failed:`, err);
      }
    });
  }

  // The signup page resumes on the code step (or the welcome step) from the live session.
  const res = NextResponse.json({ next: `/signup?step=welcome${pending.fromScan ? "&from=scan" : ""}` });
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  setHomeCookie(res, user.id, user.homeCountry, session.token);
  res.cookies.set(DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE,
  });
  res.cookies.set(X_PENDING_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
