import { NextResponse } from "next/server";
import { handleNotification } from "@/lib/server/appleIap";

/**
 * App Store Server Notifications V2 (lib/server/appleIap.ts): renewals, expiry, billing trouble and refunds for
 * purchases made in the iPhone app. Set as BOTH the Production and the Sandbox Server URL in App Store Connect
 * (App Information > App Store Server Notifications): https://cardflip.io/api/iap/apple/notify
 * The body is { signedPayload }, signed by Apple: a bad signature is a 400 (Apple will not fix it by retrying),
 * a database error a 500 (Apple retries with backoff).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { signedPayload?: unknown } | null;
  const signed = typeof body?.signedPayload === "string" ? body.signedPayload : "";
  if (!signed) return NextResponse.json({ error: "bad payload" }, { status: 400 });
  let outcome: string;
  try {
    outcome = await handleNotification(signed);
  } catch (err) {
    const bad = err instanceof Error && /verif|signature|certificate|chain|jws/i.test(`${err.name} ${err.message}`);
    console.error(`apple notify: ${bad ? "refused" : "failed"}:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: bad ? "bad signature" : "handler failed" }, { status: bad ? 400 : 500 });
  }
  console.info(`apple notify: ${outcome}`);
  return NextResponse.json({ received: true });
}
