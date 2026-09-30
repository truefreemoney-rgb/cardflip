import { NextResponse } from "next/server";
import { countryFrom } from "@/lib/server/signupGuard";

/**
 * The visitor's IP country, for the client pieces that need it (GA consent
 * bar for GB/IE, the currency hint for signed-out visitors). An endpoint, not
 * a proxy cookie: a Set-Cookie on page responses would stop the CDN caching
 * /cards pages. null off Vercel.
 */
export async function GET(req: Request) {
  return NextResponse.json({ country: countryFrom(req) }, { headers: { "cache-control": "private, no-store" } });
}
