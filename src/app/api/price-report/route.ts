import { NextResponse } from "next/server";
import { LIMITS, clientIp } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";
import { hashIp } from "@/lib/server/signupGuard";
import { addPriceReport, parsePriceReport } from "@/lib/server/priceReports";

/**
 * "Price looks wrong?" on card pages (A-H #9, lib/server/priceReports.ts). POST {path, variant, direction, price}.
 * Public like the card pages themselves: IP rate limited, path shape validated, one vote per visitor per card.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const limited = await limitOrRespondAsync(`price-report:${ip}`, LIMITS.priceReport);
  if (limited) return limited;
  const report = parsePriceReport(await req.json().catch(() => null));
  if (!report) return NextResponse.json({ error: "Bad report" }, { status: 400 });
  await addPriceReport(report, hashIp(ip) ?? `local:${ip}`);
  return NextResponse.json({ ok: true });
}
