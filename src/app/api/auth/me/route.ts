import { NextResponse, after } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/server/auth";
import { sessionCookieOptions, touchSession } from "@/lib/server/sessions";
import { toPublicUser } from "@/lib/server/users";
import { dailyDue, runDailyIfDue } from "@/lib/server/dailyJobs";

/**
 * Who's signed in — every app page asks on load. That makes it the natural
 * place to keep a returning seller signed in: a live session older than a
 * day gets slid out to a fresh 30 days and the cookie is re-issued to match
 * (see sessions.ts). Nothing happens for a young session or no session.
 */
export async function GET() {
  const user = await getCurrentUser();
  const res = NextResponse.json({ user: user ? toPublicUser(user) : null });
  // Every app page load passes through here, which makes it a heartbeat for
  // the once-a-day price refresh — kicked off after the response is sent.
  // Not on Vercel: the refresh would blow the request function's time
  // budget there; Vercel Cron owns the schedule instead.
  if (!process.env.VERCEL && user && (await dailyDue())) {
    after(() => runDailyIfDue());
  }
  if (user) {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const renewed = token ? await touchSession(token) : null;
    if (renewed) {
      res.cookies.set(SESSION_COOKIE, renewed.token, sessionCookieOptions(renewed.expiresAt));
    }
  }
  return res;
}
