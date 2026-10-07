import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  GOOGLE_STATE_COOKIE,
  decideAccount,
  decodeJwtPayload,
  decodeState,
  stateMatches,
  validateClaims,
} from "@/lib/googleAuth";
import { exchangeGoogleCode, googleConfigured, googleOrigin, googleRedirectUri } from "@/lib/server/googleAuth";
import {
  TRIAL_SCANS,
  createUser,
  findUserByEmail,
  findUserByGoogleSub,
  linkGoogleSub,
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
 * "Continue with Google", step 2. Checks the state cookie, trades the code for an id_token,
 * validates its claims (lib/googleAuth.ts), then logs in / links / creates the account.
 * Every failure lands back on the page they started from with ?google_error=N (the page
 * shows the plain-words message): 1 = didn't finish, 2 = that account has extra security.
 */
export async function GET(req: Request) {
  const origin = googleOrigin(req);
  const url = new URL(req.url);
  const jar = await cookies();
  const st = decodeState(jar.get(GOOGLE_STATE_COOKIE)?.value);
  const page = st?.mode === "signup" ? "/signup" : "/login";

  const fail = (code: 1 | 2 = 1) => {
    const res = NextResponse.redirect(`${origin}${page}?google_error=${code}`, 302);
    res.cookies.set(GOOGLE_STATE_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    return res;
  };

  try {
    if (!googleConfigured()) return fail();
    const limited = await limitOrRespondAsync(`auth:google:${clientIp(req)}`, LIMITS.authAttempt);
    if (limited) return fail();
    // Denied consent, or anything Google itself refused.
    if (url.searchParams.get("error")) return fail();
    const code = url.searchParams.get("code");
    if (!st || !code || !stateMatches(st, url.searchParams.get("state"))) return fail();

    const idToken = await exchangeGoogleCode(code, googleRedirectUri(req));
    if (!idToken) return fail();
    const claims = validateClaims(decodeJwtPayload(idToken), { clientId: process.env.GOOGLE_CLIENT_ID ?? "", nonce: st.n });
    if (!claims.ok) {
      console.warn("google sign-in: claims refused:", claims.reason);
      return fail();
    }

    const bySub = await findUserByGoogleSub(claims.sub);
    const byEmail = bySub ? null : await findUserByEmail(claims.email);
    const second = (u: User) => u.role === "admin" || totpEnabled(u);
    const decision = decideAccount({
      bySub: bySub ? { hasSecondStep: second(bySub) } : null,
      byEmail: byEmail ? { hasSecondStep: second(byEmail), googleSub: byEmail.googleSub } : null,
    });
    if (decision === "refuse-stronger-account") return fail(2);

    const here = countryFrom(req);
    let user: User;
    let isNew = false;
    let unproven = false;
    let deviceToSet: string | null = null;

    if (decision === "create") {
      // Same guards as the email signup route.
      if (isDisposableEmail(claims.email)) return fail();
      const ipHash = hashIp(clientIp(req));
      const knownDevice = deviceIdFrom(req);
      const deviceId = knownDevice ?? newDeviceId();
      const inbox = inboxKey(claims.email);
      const repeat = Boolean(await repeatSignup(ipHash, knownDevice, inbox));
      // Google proved the inbox, so no confirmation step: emailPending stays false.
      const created = await createUser(claims.name, claims.email, "", "user", { homeCountry: here, googleSub: claims.sub });
      await recordSignup(created.id, ipHash, deviceId, repeat, here, Date.now(), st.touch, inbox);
      user = repeat ? { ...created, trialScansUsed: TRIAL_SCANS } : created;
      if (st.ref) await attachReferral(user.id, st.ref).catch(() => {});
      isNew = true;
      deviceToSet = deviceId;
      if (isMailConfigured()) {
        const to = user.email;
        const first = claims.name.split(" ")[0];
        const left = trialScansLeft(user);
        await afterResponse(async () => {
          try {
            await sendSignupWelcomeEmail(to, first, left);
          } catch (err) {
            console.error(`google signup: welcome email to ${to} failed:`, err);
          }
        });
      }
    } else {
      user = (bySub ?? byEmail)!;
      // Travel rule, same as the password login.
      if (here && !isAllowedCountry(here) && user.homeCountry && !isAllowedCountry(user.homeCountry)) return fail();
      if (decision === "link") {
        unproven = !user.emailVerifiedAt;
        if (!(await linkGoogleSub(user.id, claims.sub, unproven))) return fail();
        // Google vouched for this inbox: an account still waiting on its emailed code is through.
        if (user.emailPending) {
          await markEmailConfirmed(user.id, { verified: true, email: claims.email });
        }
      }
    }

    const session = await createSession(user.id);
    if (unproven) await destroyOtherSessions(user.id, session.token);
    const dest = isNew ? `/signup?step=welcome&google=new${st.fromScan ? "&from=scan" : ""}` : st.next ?? "/app";
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
    res.cookies.set(GOOGLE_STATE_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    return res;
  } catch (err) {
    console.error("google sign-in failed:", err instanceof Error ? err.message : err);
    return fail();
  }
}
