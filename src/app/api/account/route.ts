import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AuthError, SESSION_COOKIE, clearSessionCookie, requireUser } from "@/lib/server/auth";
import { verifyPassword } from "@/lib/server/password";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";
import {
  deleteUser,
  findUserByEmail,
  isDemoUser,
  toPublicUser,
  updateUserProfile,
  userDataSummary,
} from "@/lib/server/users";
import { getEbayLink, isEbayOAuthConfigured } from "@/lib/server/ebayAuth";
import { destroyOtherSessions } from "@/lib/server/sessions";

/**
 * The account page's own endpoint.
 *
 *   GET    — profile + "your data" counts + eBay link + session count
 *   PATCH  — rename / change sign-in email (email change re-checks the password)
 *   DELETE — remove the account and everything under it (password required)
 *
 * The shared demo account is read-only here: it's public and wiped on
 * every entry, so letting a visitor rename it, change its password or
 * delete it would break the next visitor's "Try it now".
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function unauthorized(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  throw err;
}

export async function GET() {
  try {
    const user = await requireUser();
    const link = getEbayLink(user.id);
    return NextResponse.json({
      user: toPublicUser(user),
      demo: isDemoUser(user),
      data: userDataSummary(user.id),
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
  const limited = limitOrRespond(`account:patch:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  try {
    const user = await requireUser();
    if (isDemoUser(user)) {
      return NextResponse.json({ error: "The demo account can't be changed" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const patch: { name?: string; email?: string } = {};

    if (typeof body?.name === "string") {
      const name = body.name.trim();
      if (name.length < 1 || name.length > 80) {
        return NextResponse.json({ error: "Name must be 1–80 characters" }, { status: 400 });
      }
      patch.name = name;
    }

    if (typeof body?.email === "string") {
      const email = body.email.trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        return NextResponse.json({ error: "That doesn't look like an email address" }, { status: 400 });
      }
      if (email !== user.email) {
        // Changing the sign-in identity needs the password, like every other
        // account-recovery-relevant change.
        const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
        if (!verifyPassword(currentPassword, user.passwordHash)) {
          return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
        }
        const taken = findUserByEmail(email);
        if (taken && taken.id !== user.id) {
          return NextResponse.json({ error: "That email is already in use" }, { status: 409 });
        }
        patch.email = email;
      }
    }

    if (patch.name === undefined && patch.email === undefined) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    updateUserProfile(user.id, patch);
    return NextResponse.json({
      ok: true,
      user: toPublicUser({ ...user, ...patch }),
    });
  } catch (err) {
    return unauthorized(err);
  }
}

export async function DELETE(req: NextRequest) {
  const limited = limitOrRespond(`account:delete:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  try {
    const user = await requireUser();
    if (isDemoUser(user)) {
      return NextResponse.json({ error: "The demo account can't be deleted" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const password = typeof body?.password === "string" ? body.password : "";
    if (!verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "Password is incorrect" }, { status: 400 });
    }
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value ?? null;
    destroyOtherSessions(user.id, token);
    deleteUser(user.id); // cascades cards / wishlist / price checks / sessions / eBay tokens; photos removed on disk
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return unauthorized(err);
  }
}
