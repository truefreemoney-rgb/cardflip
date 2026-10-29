import { NextResponse } from "next/server";
import { APP_MODE_COOKIE } from "@/lib/appMode";
import { setHomeCookie } from "@/lib/homeCookie";
import { bearerToken, isAppRequest } from "@/lib/server/appSession";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { getSessionUserId, sessionCookieOptions, sessionExpiresAt } from "@/lib/server/sessions";
import { findUserById } from "@/lib/server/users";

/**
 * The iPhone app's sign-in handed to a web page (docs/APP-PLAN.md "Hybrid",
 * 10-28). The app holds its session as a bearer token; the website pages it
 * shows inside itself (account, packs, wishlist, …) read the cardflip_session
 * cookie. This turns the one into the other for the SAME session: no new row,
 * the cookie carries the very token the app sent, with the session's own end
 * date, plus cf_home (the travel pass the country gate reads) and the
 * cardflip_app flag that keeps the page in app mode on a reload.
 *
 * GET  ?next=/app/account  → cookies + 303 to that page with ?app=1 (the
 *      WebView loads this URL with the bearer in its request headers and lands
 *      on the page signed in).
 * POST                     → cookies + 204 (the web preview, via fetch).
 *
 * Only a caller that announces itself as the app (x-cardflip-app) with a
 * token shaped like one we issued gets anywhere; everything else is 401.
 */
const ONE_YEAR_S = 365 * 24 * 60 * 60;

function safeNext(raw: string | null): string {
  // Same-site relative paths only: "/app/account", never "//evil" or "https://…".
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || /[\\\s]/.test(raw)) return "/app/account";
  return raw;
}

function withAppFlag(path: string): string {
  return /[?&]app=1(?:&|$)/.test(path) ? path : `${path}${path.includes("?") ? "&" : "?"}app=1`;
}

async function handoff(req: Request, redirectTo: string | null): Promise<NextResponse> {
  if (!isAppRequest(req)) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const token = bearerToken(req.headers);
  if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const [userId, expiresAt] = await Promise.all([getSessionUserId(token), sessionExpiresAt(token)]);
  const user = userId && expiresAt ? await findUserById(userId) : null;
  if (!user || !expiresAt) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const res = redirectTo ? NextResponse.redirect(new URL(withAppFlag(redirectTo), req.url), 303) : new NextResponse(null, { status: 204 });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  setHomeCookie(res, user.id, user.homeCountry, token);
  // Readable by the page's inline script (lib/appMode.ts), so not httpOnly.
  res.cookies.set(APP_MODE_COOKIE, "1", { httpOnly: false, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: ONE_YEAR_S });
  return res;
}

export async function GET(req: Request) {
  return handoff(req, safeNext(new URL(req.url).searchParams.get("next")));
}

export async function POST(req: Request) {
  return handoff(req, null);
}
