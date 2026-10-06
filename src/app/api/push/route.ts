import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { LIMITS, clientIp } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";
import { countPushSubscriptions, isPushConfigured, removePushSubscription, savePushSubscription, sendPushToUser, vapidPublicKey } from "@/lib/server/push";

/**
 * Phone notifications (Tier 2 #9).
 *   GET    — { configured, publicKey, devices } for the Account row
 *   POST   — save this browser's PushSubscription (the body is sub.toJSON())
 *   DELETE — { endpoint } forget this browser
 *   PUT    — send a test banner to every device the user turned on
 */

function unauthorized(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
  throw err;
}

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ configured: isPushConfigured(), publicKey: vapidPublicKey(), devices: await countPushSubscriptions(user.id) });
  } catch (err) {
    return unauthorized(err);
  }
}

export async function POST(req: NextRequest) {
  const limited = await limitOrRespondAsync(`push:sub:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  try {
    const user = await requireUser();
    if (!isPushConfigured()) return NextResponse.json({ error: "Notifications aren't set up on this server yet." }, { status: 503 });
    const body = await req.json().catch(() => null);
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
    const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : "";
    const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : "";
    if (!endpoint || !p256dh || !auth) return NextResponse.json({ error: "That doesn't look like a push subscription." }, { status: 400 });
    await savePushSubscription(user.id, { endpoint, keys: { p256dh, auth } }, req.headers.get("user-agent"));
    return NextResponse.json({ ok: true, devices: await countPushSubscriptions(user.id) });
  } catch (err) {
    return unauthorized(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
    if (!endpoint) return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
    const removed = await removePushSubscription(user.id, endpoint);
    return NextResponse.json({ ok: true, removed, devices: await countPushSubscriptions(user.id) });
  } catch (err) {
    return unauthorized(err);
  }
}

export async function PUT(req: NextRequest) {
  const limited = await limitOrRespondAsync(`push:test:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  try {
    const user = await requireUser();
    const r = await sendPushToUser(user.id, {
      title: "CardFlip notifications are on",
      body: "Dips, sales, price alerts and support replies will show up here.",
      url: "/app/account",
      tag: "test",
    });
    return NextResponse.json(r);
  } catch (err) {
    return unauthorized(err);
  }
}
