import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  DEMO_EMAIL,
  createUser,
  findUserByEmail,
  toPublicUser,
} from "@/lib/server/users";
import { disconnectEbay } from "@/lib/server/ebayAuth";
import { deleteCardPhoto } from "@/lib/server/cardPhotos";
import { createSession, sessionCookieOptions } from "@/lib/server/sessions";
import { SESSION_COOKIE } from "@/lib/server/auth";

/**
 * "Try it now" needs an account to attach scans to, but it shouldn't force
 * anyone through a form first. Reuses one fixed demo user across visits and
 * wipes its card history each time, so nobody lands mid-way through a
 * stranger's test data.
 */
export async function POST() {
  let user = findUserByEmail(DEMO_EMAIL);
  if (!user) {
    user = createUser("Demo User", DEMO_EMAIL, crypto.randomUUID());
  }

  // The demo must never carry an eBay link — it's a shared account and eBay's
  // own reviewer walks in through this button. Connect is refused for the demo
  // user, but scrub anyway so nothing can leak between visitors.
  disconnectEbay(user.id);
  for (const row of db.prepare("SELECT id FROM cards WHERE user_id = ? AND photo_at IS NOT NULL").all(user.id) as { id: string }[]) {
    deleteCardPhoto(row.id);
  }
  db.prepare("DELETE FROM cards WHERE user_id = ?").run(user.id);

  const session = createSession(user.id);
  const res = NextResponse.json({
    user: toPublicUser({ ...user, ebayConnected: false }),
  });
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return res;
}
