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
import { seedDemoCards } from "@/lib/server/demoSeed";
import { createSession, sessionCookieOptions } from "@/lib/server/sessions";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";

/**
 * "Try it now" needs an account to attach scans to, but it shouldn't force
 * anyone through a form first. Reuses one fixed demo user across visits and
 * wipes its card history each time, so nobody lands mid-way through a
 * stranger's test data.
 */
export async function POST(req: Request) {
  // Each call wipes the shared demo ledger — cap it so a script can't keep
  // resetting it under a real visitor (or eBay's reviewer).
  const limited = limitOrRespond(`auth:demo:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;

  try {
    return await startDemo();
  } catch (err) {
    console.error("Demo sign-in failed:", err);
    return NextResponse.json({ error: "Couldn't start the demo" }, { status: 500 });
  }
}

async function startDemo() {
  let user = await findUserByEmail(DEMO_EMAIL);
  if (!user) {
    user = await createUser("Demo User", DEMO_EMAIL, crypto.randomUUID());
  }

  // The demo must never carry an eBay link — it's a shared account and eBay's
  // own reviewer walks in through this button. Connect is refused for the demo
  // user, but scrub anyway so nothing can leak between visitors.
  await disconnectEbay(user.id);
  for (const row of (await db.prepare("SELECT id FROM cards WHERE user_id = ? AND photo_at IS NOT NULL").all(user.id)) as { id: string }[]) {
    deleteCardPhoto(row.id);
  }
  await db.prepare("DELETE FROM cards WHERE user_id = ?").run(user.id);
  await db.prepare("DELETE FROM price_checks WHERE user_id = ?").run(user.id);
  await db.prepare("DELETE FROM wishlist_items WHERE user_id = ?").run(user.id);
  // A fresh visitor should see the product, not blank states — seed a small
  // ledger of real catalog cards across draft/listed/sold.
  await seedDemoCards(user.id);

  const session = await createSession(user.id);
  const res = NextResponse.json({
    user: toPublicUser({ ...user, ebayConnected: false }),
  });
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return res;
}
