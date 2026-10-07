import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AuthError, SESSION_COOKIE, clearSessionCookie, requireUser } from "@/lib/server/auth";
import { confirmsPassword } from "@/lib/server/password";
import { LIMITS, clientIp, type RateLimitRule } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";
import {
  deleteUser,
  findUserByEmail,
  findUserByHandle,
  findUserById,
  needsEmailConfirm,
  updateUserProfile,
  userDataSummary,
} from "@/lib/server/users";
import { handleProblem, normalizeHandle } from "@/lib/handle";
import { getEbayLink, isEbayOAuthConfigured } from "@/lib/server/ebayAuth";
import { destroyOtherSessions } from "@/lib/server/sessions";
import { cancelAllSubscriptions, updateCustomerEmail } from "@/lib/server/stripe";
import { scanQuota } from "@/lib/server/scanQuota";
import { isValidEmail } from "@/lib/emailAddress";
import { isDisposableEmail } from "@/lib/server/signupGuard";
import {
  emailConfirmEnabled,
  limitCodeMail,
  limitWithMessage,
  pendingEmailChange,
  publicUserWithEmailState,
  sendChangeCode,
  sendWalledCode,
} from "@/lib/server/emailVerify";

/**
 * The account page's own endpoint.
 *
 *   GET    — profile + "your data" counts + eBay link + session count, and
 *            `pendingEmail` ({ email, expiresAt } | null): an email change
 *            waiting for its code
 *   PATCH  — rename / change sign-in email (email change re-checks the password).
 *            With email confirmation on, a change on an established account
 *            mails a code to the NEW address and leaves users.email alone
 *            until it is typed (the old address keeps working): the response
 *            carries `pendingEmail` and `emailCodeExpiresAt`, and the code
 *            goes to POST /api/auth/verify-email. An account still waiting on
 *            its first code just moves to the new address (no password; it
 *            was never proven) and gets a code there.
 *   DELETE — remove the account and everything under it (password required)
 */


function unauthorized(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  throw err;
}

export async function GET() {
  try {
    const user = await requireUser();
    const link = await getEbayLink(user.id);
    return NextResponse.json({
      user: await publicUserWithEmailState(user),
      pendingEmail: await pendingEmailChange(user),
      quota: scanQuota(user),
      data: await userDataSummary(user.id),
      ebay: {
        available: isEbayOAuthConfigured(),
        connected: Boolean(link),
        ebayUsername: link?.ebayUsername ?? null,
        connectedAt: link?.connectedAt ?? null,
      },
    });
  } catch (err) {
    return unauthorized(err);
  }
}

export async function PATCH(req: NextRequest) {
  // Durable (10-01 sweep): an email change re-checks the password, and the memory limiter never binds on serverless.
  const limited = await limitOrRespondAsync(`account:patch:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  try {
    const user = await requireUser();
    const mineLimited = await limitOrRespondAsync(`account:patch:acct:${user.id}`, LIMITS.authAccount);
    if (mineLimited) return mineLimited;
    const body = await req.json().catch(() => ({}));
    const patch: { name?: string; email?: string; handle?: string | null; handlePublic?: boolean; pricingOnly?: boolean } = {};

    // Pricing-only mode (10-04): a UI switch, so no other checks.
    if (typeof body?.pricingOnly === "boolean") patch.pricingOnly = body.pricingOnly;

    // Public collection page (Tier 2 #10): "" clears the handle (and closes
    // the page); a new handle must be free. The switch is separate so the
    // page can be closed without losing the name.
    if (typeof body?.handle === "string") {
      const handle = normalizeHandle(body.handle);
      if (!handle) {
        patch.handle = null;
        patch.handlePublic = false;
      } else if (handle !== user.handle) {
        const problem = handleProblem(handle);
        if (problem) return NextResponse.json({ error: problem }, { status: 400 });
        const taken = await findUserByHandle(handle);
        if (taken && taken.id !== user.id) {
          return NextResponse.json({ error: "That one is taken" }, { status: 409 });
        }
        patch.handle = handle;
      }
    }
    if (typeof body?.handlePublic === "boolean") {
      const handle = patch.handle !== undefined ? patch.handle : user.handle;
      if (body.handlePublic && !handle) {
        return NextResponse.json({ error: "Pick a handle first" }, { status: 400 });
      }
      patch.handlePublic = body.handlePublic && Boolean(handle);
    }

    if (typeof body?.name === "string") {
      const name = body.name.trim();
      if (name.length < 1 || name.length > 80) {
        return NextResponse.json({ error: "Name must be 1–80 characters" }, { status: 400 });
      }
      patch.name = name;
    }

    // Where a changed email goes once everything else checked out: straight
    // into users.email (confirmation off), a code to the new address (an
    // established account, confirmation on), or a move for an account still
    // waiting on its first code.
    let emailRoute: { kind: "write" | "code" | "walled"; email: string } | null = null;
    if (typeof body?.email === "string") {
      const email = body.email.trim().toLowerCase();
      if (!isValidEmail(email)) {
        return NextResponse.json({ error: "That doesn't look like an email address" }, { status: 400 });
      }
      // Same rule as signup: no throwaway inboxes on an account.
      if (isDisposableEmail(email)) {
        return NextResponse.json({ error: "Please use your real email address." }, { status: 400 });
      }
      if (email !== user.email) {
        const walled = needsEmailConfirm(user);
        if (!walled) {
          // Changing the sign-in identity needs the password, like every other
          // account-recovery-relevant change.
          const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
          if (!confirmsPassword(currentPassword, user.passwordHash)) {
            return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
          }
        }
        const sendsCode = walled || (await emailConfirmEnabled());
        if (sendsCode) {
          // The "already in use" answer below tells anyone who can reach it
          // whether an address has an account, and a walled account gets here
          // with no password, so the network's limit (shared with the resend
          // route, on the shared counter, not this route's per-instance one)
          // comes first.
          const probeKeys: Array<[string, RateLimitRule[]]> = [[`auth:code:${clientIp(req)}`, LIMITS.authAttempt]];
          if (walled) probeKeys.push([`auth:code:probe:${user.id}`, LIMITS.authAccount]);
          const probed = await limitWithMessage(probeKeys);
          if (probed) return probed;
        }
        const taken = await findUserByEmail(email);
        if (taken && taken.id !== user.id) {
          return NextResponse.json({ error: "That email is already in use" }, { status: 409 });
        }
        if (sendsCode) {
          // Mailing a code: one every 30 s per account and per address, and a
          // day's share per network, on the shared counter.
          const limited =
            (await limitWithMessage([
              [`auth:code:acct:${user.id}`, LIMITS.emailCode],
              [`auth:code:to:${email}`, LIMITS.emailCode],
            ])) ?? (await limitCodeMail(req));
          if (limited) return limited;
        }
        emailRoute = { kind: walled ? "walled" : sendsCode ? "code" : "write", email };
        if (emailRoute.kind === "write") patch.email = email;
      }
    }

    if (patch.name === undefined && patch.email === undefined && patch.handle === undefined && patch.handlePublic === undefined && patch.pricingOnly === undefined && !emailRoute) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    if (Object.keys(patch).length > 0) await updateUserProfile(user.id, patch);
    // Receipts go to the Stripe customer's email; a failure here must not block the change (it logs).
    if (patch.email) await updateCustomerEmail(user.stripeCustomerId, patch.email);

    let current = user;
    const extra: Record<string, unknown> = {};
    if (emailRoute?.kind === "code") {
      const sent = await sendChangeCode(user, emailRoute.email);
      if (!sent.ok) return NextResponse.json({ error: sent.message, code: sent.error }, { status: sent.status });
      extra.pendingEmail = sent.email;
      extra.emailCodeExpiresAt = sent.expiresAt;
    } else if (emailRoute?.kind === "walled") {
      const out = await sendWalledCode(user, emailRoute.email);
      if (out.kind === "problem") {
        return NextResponse.json({ error: out.problem.message, code: out.problem.error }, { status: out.problem.status });
      }
      current = (await findUserById(user.id)) ?? user;
      if (out.kind === "refused") {
        return NextResponse.json(
          { error: "That address didn't accept our email. Check it and try again.", code: "recipient_refused", user: await publicUserWithEmailState({ ...current, ...patch }) },
          { status: 400 },
        );
      }
      extra.emailSent = out.kind === "sent";
      extra.released = out.kind === "released";
    }
    return NextResponse.json({
      ok: true,
      user: await publicUserWithEmailState({ ...current, ...patch }),
      ...extra,
    });
  } catch (err) {
    return unauthorized(err);
  }
}

export async function DELETE(req: NextRequest) {
  // Durable, per IP and per account (10-01 sweep): a stolen session guessing the password here deletes the account.
  const limited = await limitOrRespondAsync(`account:delete:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  try {
    const user = await requireUser();
    const mine = await limitOrRespondAsync(`account:delete:acct:${user.id}`, LIMITS.authAccount);
    if (mine) return mine;
    const body = await req.json().catch(() => ({}));
    const password = typeof body?.password === "string" ? body.password : "";
    if (!confirmsPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "Password is incorrect" }, { status: 400 });
    }
    // Stop the billing first: a deleted account has no login left to cancel with, so it would be charged until it disputes.
    try {
      await cancelAllSubscriptions(user.stripeCustomerId, user.stripeSubscriptionId);
    } catch (err) {
      console.error("account delete: subscription cancel failed:", err);
      return NextResponse.json(
        { error: "We couldn't cancel your subscription just now, so your account was not deleted. Try again in a minute, or cancel in Billing first." },
        { status: 502 },
      );
    }
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value ?? null;
    await destroyOtherSessions(user.id, token);
    await deleteUser(user.id); // cascades cards / wishlist / price checks / sessions / eBay tokens; photos removed on disk
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return unauthorized(err);
  }
}
