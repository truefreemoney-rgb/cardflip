import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  X_PENDING_COOKIE,
  X_PENDING_MAX_AGE_S,
  X_STATE_COOKIE,
  decideXAccount,
  decodeXState,
  parseXProfile,
  xStateMatches,
} from "@/lib/xAuth";
import {
  exchangeXCode,
  fetchXProfile,
  signXPending,
  xConfigured,
  xOrigin,
  xRedirectUri,
} from "@/lib/server/xAuth";
import {
  TRIAL_SCANS,
  createUser,
  findUserByEmail,
  findUserByXSub,
  linkXSub,
  totpEnabled,
  trialScansLeft,
  type User,
} from "@/lib/server/users";
import { createSession, destroyOtherSessions, sessionCookieOptions } from "@/lib/server/sessions";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { LIMITS, clientIp } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";
import { attachReferral } from "@/lib/server/referrals";
import { isMailConfigured, sendSignupWelcomeEmail } from "@/lib/server/mail";
import { afterResponse, markEmailConfirmed } from "@/lib/server/emailVerify";
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_MAX_AGE,
  countryFrom,
  deviceIdFrom,
  hashIp,
  inboxKey,
  isDisposableEmail,
  newDeviceId,
  recordSignup,
  repeatSignup,
} from "@/lib/server/signupGuard";
import { isAllowedCountry } from "@/lib/countries";
import { setHomeCookie } from "@/lib/homeCookie";

/**
 * "Continue with X", step 2. Checks the state cookie, trades the code (with the PKCE verifier) for
 * an access token, reads the profile, then logs in / links / creates the account. X does not always
 * share an email: then a signed "x_pending" cookie carries the identity to /signup?x=email, and
 * POST /api/auth/x/finish makes the account once an email is typed. Every failure lands back on the
 * page they started from with ?x_error=N: 1 = didn't finish, 2 = that account has extra security.
 */
export async function GET(req: Request) {
  const origin = xOrigin(req);
  const url = new URL(req.url);
  const jar = await cookies();
  const st = decodeXState(jar.get(X_STATE_COOKIE)?.value);
  const page = st?.mode === "signup" ? "/signup" : "/login";

  const fail = (code: 1 | 2 = 1) => {
    const res = NextResponse.redirect(`${origin}${page}?x_error=${code}`, 302);
    res.cookies.set(X_STATE_COOKIE, "", { path: "/api/auth/x", maxAge: 0 });
    return res;
  };

  try {
    if (!xConfigured()) return fail();
    const limited = await limitOrRespondAsync(`auth:x:${clientIp(req)}`, LIMITS.authAttempt);
    if (limited) return fail();
    // Denied consent, or anything X itself refused.
    if (url.searchParams.get("error")) return fail();
    const code = url.searchParams.get("code");
    if (!st || !code || !xStateMatches(st, url.searchParams.get("state"))) return fail();

    const token = await exchangeXCode(code, xRedirectUri(req), st.v);
    if (!token) return fail();
    const profile = parseXProfile(await fetchXProfile(token));
    if (!profile.ok) {
      console.warn("x sign-in: profile refused:", profile.reason);
      return fail();
    }

    const bySub = await findUserByXSub(profile.sub);
    const byEmail = bySub || !profile.email ? null : await findUserByEmail(profile.email);
    const second = (u: User) => u.role === "admin" || totpEnabled(u);
    const decision = decideXAccount({
      bySub: bySub ? { hasSecondStep: second(bySub) } : null,
      hasEmail: Boolean(profile.email),
      byEmail: byEmail ? { hasSecondStep: second(byEmail), xSub: byEmail.xSub } : null,
    });
    if (decision === "refuse-stronger-account") return fail(2);

    if (decision === "need-email") {
      // X did not share an email. Keep who they are in a short signed cookie and ask for one.
      const res = NextResponse.redirect(`${origin}/signup?x=email`, 302);
      res.cookies.set(
        X_PENDING_COOKIE,
        signXPending({
          sub: profile.sub,
          name: profile.name,
          username: profile.username,
          mode: st.mode,
          next: st.next,
          ref: st.ref,
          touch: st.touch,
          fromScan: st.fromScan,
          iat: Date.now(),
        }),
        {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: X_PENDING_MAX_AGE_S,
        },
      );
      res.cookies.set(X_STATE_COOKIE, "", { path: "/api/auth/x", maxAge: 0 });
      return res;
    }

    const email = profile.email!;
    const here = countryFrom(req);
    let user: User;
    let isNew = false;
    let unproven = false;
    let deviceToSet: string | null = null;

    if (decision === "create") {
      // Same guards as the email signup route.
      if (isDisposableEmail(email)) return fail();
      const ipHash = hashIp(clientIp(req));
      const knownDevice = deviceIdFrom(req);
      const deviceId = knownDevice ?? newDeviceId();
      const inbox = inboxKey(email);
      const repeat = Boolean(await repeatSignup(ipHash, knownDevice, inbox));
      // X confirmed the inbox, so no confirmation step: emailPending stays false.
      const created = await createUser(profile.name, email, "", "user", {
        homeCountry: here,
        xSub: profile.sub,
        emailVerified: true,
      });
      await recordSignup(created.id, ipHash, deviceId, repeat, here, Date.now(), st.touch, inbox);
      user = repeat ? { ...created, trialScansUsed: TRIAL_SCANS } : created;
      if (st.ref) await attachReferral(user.id, st.ref).catch(() => {});
      isNew = true;
      deviceToSet = deviceId;
      if (isMailConfigured()) {
        const to = user.email;
        const first = profile.name.split(" ")[0];
        const left = trialScansLeft(user);
        await afterResponse(async () => {
          try {
            await sendSignupWelcomeEmail(to, first, left);
          } catch (err) {
            console.error(`x signup: welcome email to ${to} failed:`, err);
          }
        });
      }
    } else {
      user = (bySub ?? byEmail)!;
      // Travel rule, same as the password login.
      if (here && !isAllowedCountry(here) && user.homeCountry && !isAllowedCountry(user.homeCountry)) return fail();
      if (decision === "link") {
        unproven = !user.emailVerifiedAt;
        if (!(await linkXSub(user.id, profile.sub, unproven))) return fail();
        // X vouched for this inbox: an account still waiting on its emailed code is through.
        if (user.emailPending) {
          await markEmailConfirmed(user.id, { verified: true, email });
        }
      }
    }

    const session = await createSession(user.id);
    if (unproven) await destroyOtherSessions(user.id, session.token);
    const dest = isNew ? `/signup?step=welcome&x=new${st.fromScan ? "&from=scan" : ""}` : st.next ?? "/app";
    const res = NextResponse.redirect(`${origin}${dest}`, 302);
    res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    setHomeCookie(res, user.id, user.homeCountry, session.token);
    if (deviceToSet) {
      res.cookies.set(DEVICE_COOKIE, deviceToSet, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: DEVICE_COOKIE_MAX_AGE,
      });
    }
    res.cookies.set(X_STATE_COOKIE, "", { path: "/api/auth/x", maxAge: 0 });
    return res;
  } catch (err) {
    console.error("x sign-in failed:", err instanceof Error ? err.message : err);
    return fail();
  }
}
