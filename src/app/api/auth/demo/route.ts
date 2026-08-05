import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  createUser,
  findUserByEmail,
  setEbayConnected,
  toPublicUser,
} from "@/lib/server/users";
import { createSession } from "@/lib/server/sessions";
import { SESSION_COOKIE } from "@/lib/server/auth";

const DEMO_EMAIL = "demo@cardflip.dev";

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

  setEbayConnected(user.id, true);
  db.prepare("DELETE FROM cards WHERE user_id = ?").run(user.id);

  const session = createSession(user.id);
  const res = NextResponse.json({
    user: toPublicUser({ ...user, ebayConnected: true }),
  });
  res.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(session.expiresAt),
  });
  return res;
}
