import "server-only";
import webpush from "web-push";
import { db } from "@/lib/db";
import type { PushMessage } from "@/lib/pushMessages";

/**
 * Web Push (Tier 2 #9, 09-27): phone banners for the events that already
 * mail — watchlist dips, owned-card alerts, a sale, a support reply. iPhone
 * home-screen PWAs deliver these since iOS 16.4; the seller turns them on
 * from Account → Phone notifications (a user gesture is required for the
 * permission prompt).
 *
 * Keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT (mailto:).
 * `npm run push:keys` prints a fresh pair. Unconfigured = every send is a
 * silent no-op, so nothing else in the app depends on the keys existing.
 *
 * Every send is best-effort: a dead subscription (404/410 from the push
 * service) is deleted, any other failure is logged, and the caller never
 * sees a throw — a push must never cost the email it rides alongside.
 */

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface SubRow {
  endpoint: string;
  user_id: string;
  p256dh: string;
  auth: string;
}

export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

let configured = false;
function ensureVapid(): boolean {
  if (!isPushConfigured()) return false;
  if (!configured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:support@cardflip.io",
      process.env.VAPID_PUBLIC_KEY as string,
      process.env.VAPID_PRIVATE_KEY as string,
    );
    configured = true;
  }
  return true;
}

const ENDPOINT_MAX = 2048;

/** Save (or re-own) a browser's subscription. One endpoint belongs to one user. */
export async function savePushSubscription(userId: string, sub: PushSubscriptionInput, userAgent: string | null, now = Date.now()): Promise<void> {
  if (!/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > ENDPOINT_MAX) throw new Error("Bad push endpoint");
  if (!sub.keys?.p256dh || !sub.keys?.auth) throw new Error("Bad push keys");
  await db
    .prepare(
      `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent`,
    )
    .run(sub.endpoint, userId, sub.keys.p256dh, sub.keys.auth, userAgent ? userAgent.slice(0, 300) : null, now);
}

export async function removePushSubscription(userId: string, endpoint: string): Promise<boolean> {
  const r = await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").run(endpoint, userId);
  return (r as { changes?: number }).changes ? true : false;
}

export async function countPushSubscriptions(userId: string): Promise<number> {
  const row = (await db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?").get(userId)) as { n: number } | undefined;
  return row?.n ?? 0;
}

export interface PushSendResult {
  /** Devices the banner went to. */
  sent: number;
  /** Dead subscriptions removed. */
  dropped: number;
  failed: number;
}

export type PushTransport = (sub: PushSubscriptionInput, payload: string) => Promise<void>;

const defaultTransport: PushTransport = async (sub, payload) => {
  await webpush.sendNotification(sub, payload, { TTL: 60 * 60 * 24, urgency: "normal" });
};

/**
 * One message to every device the user turned on. Never throws.
 * `transport` is the test seam (scripts/test-push.mjs).
 */
export async function sendPushToUser(userId: string, message: PushMessage, transport?: PushTransport, now = Date.now()): Promise<PushSendResult> {
  const out: PushSendResult = { sent: 0, dropped: 0, failed: 0 };
  if (!transport && !ensureVapid()) return out;
  const send = transport ?? defaultTransport;
  let rows: SubRow[];
  try {
    rows = (await db.prepare("SELECT endpoint, user_id, p256dh, auth FROM push_subscriptions WHERE user_id = ?").all(userId)) as unknown as SubRow[];
  } catch (err) {
    console.error("[push] subscription read failed:", err instanceof Error ? err.message : err);
    return out;
  }
  if (rows.length === 0) return out;
  const payload = JSON.stringify(message);
  for (const r of rows) {
    try {
      await send({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload);
      out.sent++;
      await db.prepare("UPDATE push_subscriptions SET last_sent_at = ? WHERE endpoint = ?").run(now, r.endpoint);
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(r.endpoint);
        out.dropped++;
      } else {
        out.failed++;
        console.error(`[push] send to ${userId} failed (${status ?? "?"}):`, err instanceof Error ? err.message : err);
      }
    }
  }
  return out;
}
