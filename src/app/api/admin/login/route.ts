import { NextResponse } from "next/server";
import { adminUsingDefaults, verifyAdminLogin } from "@/lib/adminAuth";
import { ADMIN_COOKIE, adminCookieOptions, issueAdminSession } from "@/lib/server/adminGate";
import { LIMITS, clientIp } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";
import { consoleCodeRequired, sendConsoleCode, spendConsoleCode } from "@/lib/server/loginCode";
import { maskEmail } from "@/lib/server/emailVerify";
import { OWNER_EMAIL } from "@/lib/server/users";

/** Admin panel sign-in: username + password → signed cookie, 5 min idle (kept alive by /api/admin/touch). */
export async function POST(req: Request) {
  const limited = await limitOrRespondAsync(`auth:admin:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  // The built-in operator credentials are in the public repo. In production
  // they are not a login: refuse until ADMIN_PANEL_USER / ADMIN_PANEL_PASSWORD
  // are set in Vercel (09-09 audit).
  if (process.env.NODE_ENV === "production" && adminUsingDefaults()) {
    return NextResponse.json({ error: "The console is locked until ADMIN_PANEL_USER and ADMIN_PANEL_PASSWORD are set in the environment." }, { status: 503 });
  }
  const body = await req.json().catch(() => null);
  const user = typeof body?.username === "string" ? body.username : "";
  const password = typeof body?.password === "string" ? body.password : "";
  // Per-username lockout on top of the IP one (rotating IPs still stop).
  if (user) {
    const locked = await limitOrRespondAsync(`auth:admin:acct:${user.toLowerCase()}`, LIMITS.authAccount);
    if (locked) return locked;
  }
  const role = verifyAdminLogin(user, password);
  if (!role) {
    return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
  }
  // The owner's password alone is not a console session on the live site (Chris,
  // 09-30): a 6-digit code goes to the owner's inbox and the same form comes back with it.
  if (consoleCodeRequired(role)) {
    const code = typeof body?.code === "string" ? body.code : "";
    if (!code) {
      if ((await sendConsoleCode()) === "failed") {
        return NextResponse.json({ error: "We couldn't email your sign-in code. Try again in a minute." }, { status: 503 });
      }
      return NextResponse.json({ codeRequired: true, error: `We emailed a 6-digit code to ${maskEmail(OWNER_EMAIL)}. It works for 10 minutes.` }, { status: 401 });
    }
    if (!(await spendConsoleCode(code))) {
      return NextResponse.json({ codeRequired: true, error: "That code didn't match or has expired. Check the newest email, or send a new code." }, { status: 401 });
    }
  }
  const { token, expiresAt } = issueAdminSession(role);
  const res = NextResponse.json({ ok: true, expiresAt, role });
  res.cookies.set(ADMIN_COOKIE, token, adminCookieOptions(expiresAt));
  return res;
}
