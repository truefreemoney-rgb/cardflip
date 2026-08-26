import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/siteUrl";
import { purgeEbayAccount } from "@/lib/server/ebayAuth";

/**
 * eBay marketplace account deletion notifications — eBay requires a live
 * endpoint here before it will grant a production keyset. Validation is a GET
 * with ?challenge_code=…; eBay expects back the hex SHA-256 of
 * challengeCode + verificationToken + endpointUrl. Real deletion notices
 * arrive as POSTs and must be acknowledged with a 2xx.
 *
 * EBAY_VERIFICATION_TOKEN (32–80 chars, we choose it) is pasted into the eBay
 * developer portal together with this endpoint's URL. The URL registered
 * there must match EBAY_DELETION_ENDPOINT_URL exactly, or the challenge hash
 * won't agree and eBay will mark the endpoint failed.
 */

const ENDPOINT_URL =
  process.env.EBAY_DELETION_ENDPOINT_URL ??
  `${SITE_URL}/api/ebay/account-deletion`;

export async function GET(req: Request) {
  const token = process.env.EBAY_VERIFICATION_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "EBAY_VERIFICATION_TOKEN is not configured" },
      { status: 503 },
    );
  }

  const challengeCode = new URL(req.url).searchParams.get("challenge_code");
  if (!challengeCode) {
    return NextResponse.json({ error: "Missing challenge_code" }, { status: 400 });
  }

  const challengeResponse = createHash("sha256")
    .update(challengeCode + token + ENDPOINT_URL)
    .digest("hex");
  return NextResponse.json({ challengeResponse });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const data = body?.notification?.data;

  // The only eBay-account data we hold is the OAuth link (tokens + username).
  // Drop every CardFlip user's link to that eBay account and log the notice
  // for the audit trail. Always 200 — eBay retries and eventually marks the
  // endpoint failed on anything else.
  const username = typeof data?.username === "string" ? data.username : null;
  const userId = typeof data?.userId === "string" ? data.userId : null;
  const purged = username || userId ? await purgeEbayAccount(userId, username) : 0;
  console.log("[ebay] account deletion notice", { username, userId, purged });

  return new NextResponse(null, { status: 200 });
}
