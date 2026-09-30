import { NextResponse } from "next/server";
import { LIMITS, clientIp } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";
import { countryFrom, hashIp, isDisposableEmail } from "@/lib/server/signupGuard";
import { isValidEmail } from "@/lib/emailAddress";
import { joinWaitlist } from "@/lib/server/waitlist";

/**
 * The /unavailable screen's email box. Country from the request header only;
 * the same 200 whether the email was new, already listed, or a bot filled the
 * hidden "website" field, so the form reveals nothing.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const limited = await limitOrRespondAsync(`waitlist:${ip}`, LIMITS.waitlist);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  const ok = NextResponse.json({ ok: true });
  if (typeof body?.website === "string" && body.website.trim()) return ok; // honeypot
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!isValidEmail(email) || email.length > 254) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  if (isDisposableEmail(email)) {
    return NextResponse.json({ error: "Please use your real email address." }, { status: 400 });
  }
  await joinWaitlist(email, countryFrom(req), hashIp(ip));
  return ok;
}
