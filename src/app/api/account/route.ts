import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AuthError, SESSION_COOKIE, clearSessionCookie, requireUser } from "@/lib/server/auth";
import { verifyPassword } from "@/lib/server/password";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";
import {
  deleteUser,
  findUserByEmail,
  findUserByHandle,
  toPublicUser,
  updateUserProfile,
  userDataSummary,
} from "@/lib/server/users";
import { handleProblem, normalizeHandle } from "@/lib/handle";
import { getEbayLink, isEbayOAuthConfigured } from "@/lib/server/ebayAuth";
import { destroyOtherSessions } from "@/lib/server/sessions";
import { scanQuota } from "@/lib/server/scanQuota";

/**
 * The account page's own endpoint.
 *
 *   GET    — profile + "your data" counts + eBay link + session count
 *   PATCH  — rename / change sign-in email (email change re-checks the password)
 *   DELETE — remove the account and everything under it (password required)
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
    const link = await getEbayLink(user.id);
    return NextResponse.json({
      user: toPublicUser(user),
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
  const limited = limitOrRespond(`account:patch:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const patch: { name?: string; email?: string; handle?: string | null; handlePublic?: boolean } = {};

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
        const taken = await findUserByEmail(email);
        if (taken && taken.id !== user.id) {
          return NextResponse.json({ error: "That email is already in use" }, { status: 409 });
        }
        patch.email = email;
      }
    }

    if (patch.name === undefined && patch.email === undefined && patch.handle === undefined && patch.handlePublic === undefined) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    await updateUserProfile(user.id, patch);
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
    const body = await req.json().catch(() => ({}));
    const password = typeof body?.password === "string" ? body.password : "";
    if (!verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "Password is incorrect" }, { status: 400 });
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
