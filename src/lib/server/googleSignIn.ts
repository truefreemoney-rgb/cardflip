import "server-only";
import type { NextResponse } from "next/server";
import { decideAccount } from "@/lib/googleAuth";
import type { Touch } from "@/lib/attribution";
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
import { clientIp } from "@/lib/server/rateLimit";
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

/** What the page knew about the visitor when they tapped Google (state cookie, or the One Tap body). */
export interface GoogleSignInContext {
  /** Same-site path for an existing account to land on; null = /app. */
  next: string | null;
  ref: string | null;
  touch: Touch | null;
  fromScan: boolean;
}

export type GoogleSignInResult =
  /** 1 = didn't finish (refused for a plain reason), 2 = that account has extra security. */
  | { ok: false; code: 1 | 2 }
  | {
      ok: true;
      isNew: boolean;
      /** Same-site path to send the browser to. */
      dest: string;
      /** Sets the session (and device / home) cookies on the response that carries `dest`. */
      apply: (res: NextResponse) => void;
    };

/**
 * A verified Google identity → a signed-in CardFlip account. Shared by the redirect callback
 * (api/auth/google/callback) and One Tap (api/auth/google/onetap), so both make, link and open
 * accounts under exactly the same rules as the email signup: disposable inboxes refused, repeat
 * device/network starts with the trial spent, invite code + first touch recorded, welcome email,
 * travel rule, admin / two-step accounts never opened by Google alone.
 */
export async function completeGoogleSignIn(
  req: Request,
  claims: { sub: string; email: string; name: string },
  ctx: GoogleSignInContext,
): Promise<GoogleSignInResult> {
  const bySub = await findUserByGoogleSub(claims.sub);
  const byEmail = bySub ? null : await findUserByEmail(claims.email);
  const second = (u: User) => u.role === "admin" || totpEnabled(u);
  const decision = decideAccount({
    bySub: bySub ? { hasSecondStep: second(bySub) } : null,
    byEmail: byEmail ? { hasSecondStep: second(byEmail), googleSub: byEmail.googleSub } : null,
  });
  if (decision === "refuse-stronger-account") return { ok: false, code: 2 };

  const here = countryFrom(req);
  let user: User;
  let isNew = false;
  let unproven = false;
  let deviceToSet: string | null = null;

  if (decision === "create") {
    // Same guards as the email signup route.
    if (isDisposableEmail(claims.email)) return { ok: false, code: 1 };
    const ipHash = hashIp(clientIp(req));
    const knownDevice = deviceIdFrom(req);
    const deviceId = knownDevice ?? newDeviceId();
    const inbox = inboxKey(claims.email);
    const repeat = Boolean(await repeatSignup(ipHash, knownDevice, inbox));
    // Google proved the inbox, so no confirmation step: emailPending stays false.
    const created = await createUser(claims.name, claims.email, "", "user", { homeCountry: here, googleSub: claims.sub });
    await recordSignup(created.id, ipHash, deviceId, repeat, here, Date.now(), ctx.touch, inbox);
    user = repeat ? { ...created, trialScansUsed: TRIAL_SCANS } : created;
    if (ctx.ref) await attachReferral(user.id, ctx.ref).catch(() => {});
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
    if (here && !isAllowedCountry(here) && user.homeCountry && !isAllowedCountry(user.homeCountry)) return { ok: false, code: 1 };
    if (decision === "link") {
      unproven = !user.emailVerifiedAt;
      if (!(await linkGoogleSub(user.id, claims.sub, unproven))) return { ok: false, code: 1 };
      // Google vouched for this inbox: an account still waiting on its emailed code is through.
      if (user.emailPending) {
        await markEmailConfirmed(user.id, { verified: true, email: claims.email });
      }
    }
  }

  const session = await createSession(user.id);
  if (unproven) await destroyOtherSessions(user.id, session.token);
  const dest = isNew ? `/signup?step=welcome&google=new${ctx.fromScan ? "&from=scan" : ""}` : ctx.next ?? "/app";
  const home = user.homeCountry;
  const userId = user.id;
  return {
    ok: true,
    isNew,
    dest,
    apply(res) {
      res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
      setHomeCookie(res, userId, home, session.token);
      if (deviceToSet) {
        res.cookies.set(DEVICE_COOKIE, deviceToSet, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: DEVICE_COOKIE_MAX_AGE,
        });
      }
    },
  };
}
