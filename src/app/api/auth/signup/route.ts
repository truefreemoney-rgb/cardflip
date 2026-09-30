import { NextResponse } from "next/server";
import { createUser, findUserByEmail, toPublicUser } from "@/lib/server/users";
import { createSession, sessionCookieOptions } from "@/lib/server/sessions";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";
import { attachReferral } from "@/lib/server/referrals";
import { isMailConfigured, sendSignupWelcomeEmail } from "@/lib/server/mail";
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
import { TRIAL_SCANS } from "@/lib/server/users";
import { isValidEmail } from "@/lib/emailAddress";

export async function POST(req: Request) {
  // Brute-force backstop, per IP.
  const limited = limitOrRespond(`auth:signup:${clientIp(req)}`, LIMITS.authAttempt);
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
  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters." },
      { status: 400 },
    );
  }

  if (isDisposableEmail(email)) {
    return NextResponse.json({ error: "Please use your real email address." }, { status: 400 });
  }

  if (await findUserByEmail(email)) {
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

  const created = await createUser(name, email, password);
  await recordSignup(created.id, ipHash, deviceId, repeat, countryFrom(req));
  const user = repeat ? { ...created, trialScansUsed: TRIAL_SCANS } : created;
  // Invite a friend: ?ref=CODE captured on the landing page rides along.
  // Best effort — a bad or stale code never blocks the signup.
  if (typeof body?.ref === "string" && body.ref) await attachReferral(user.id, body.ref).catch(() => {});
  const session = await createSession(user.id);
  // Welcome mail (Chris, 09-25). Awaited so Vercel doesn't freeze the
  // function before the send finishes, but never fails the signup.
  if (isMailConfigured()) {
    try {
      await sendSignupWelcomeEmail(user.email, name.split(" ")[0]);
    } catch (err) {
      console.error(`signup: welcome email to ${user.email} failed:`, err);
    }
  }

  const res = NextResponse.json({ user: toPublicUser(user) }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  res.cookies.set(DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE,
  });
  return res;
}
