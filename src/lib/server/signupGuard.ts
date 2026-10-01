import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Touch } from "@/lib/attribution";
import { TRIAL_SCANS } from "@/lib/server/users";

/**
 * Throwaway-account guard (Chris 09-29, after a row of "Probe" accounts on
 * mailinator: no new accounts just for free scans):
 *  - throwaway inbox domains are refused outright (Gmail etc. are untouched);
 *  - the FIRST signup on an IP, device (cf_dev cookie) or inbox (inboxKey:
 *    Gmail dot and plus spellings are one inbox, 10-01) gets the free
 *    trial; every later one, ever, is still created but starts with the
 *    trial spent, so it lands on the Scan Pack wall. A real person behind a
 *    shared IP (household, phone carrier) can still sign up and pay.
 * Accounts made before 09-29 have no signup_log row, so they count for nothing.
 */

export const DEVICE_COOKIE = "cf_dev";
export const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2;

/** Well-known throwaway inbox services. Real providers never belong here. */
export const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "mailinator.net", "mailinator2.com", "reallymymail.com", "sogetthis.com",
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "guerrillamail.biz", "guerrillamail.de",
  "guerrillamailblock.com", "sharklasers.com", "grr.la", "pokemail.net", "spam4.me",
  "10minutemail.com", "10minutemail.net", "10minemail.com", "20minutemail.com",
  "temp-mail.org", "temp-mail.io", "tempmail.com", "tempmail.net", "tempmailo.com", "tempmail.plus",
  "tempail.com", "tempr.email", "temp-mail.email", "tmpmail.org", "tmpmail.net", "tmpeml.com",
  "throwawaymail.com", "trashmail.com", "trashmail.de", "trashmail.net", "trash-mail.com",
  "yopmail.com", "yopmail.net", "yopmail.fr", "cool.fr.nf", "jetable.org",
  "dispostable.com", "maildrop.cc", "mailnesia.com", "mailcatch.com", "mintemail.com",
  "getnada.com", "nada.email", "getairmail.com", "fakeinbox.com", "fakemail.net",
  "emailondeck.com", "mohmal.com", "mytemp.email", "moakt.com", "burnermail.io",
  "spambox.us", "spamgourmet.com", "mailpoof.com", "inboxkitten.com", "linshiyouxiang.net",
  "1secmail.com", "1secmail.net", "1secmail.org", "emlpro.com", "emltmp.com", "discard.email",
  "discardmail.com", "harakirimail.com", "mailforspam.com", "incognitomail.org", "anonbox.net",
  "33mail.com", "mail.tm", "mail.gw", "tempinbox.com", "mailtemp.net", "minuteinbox.com",
]);

/** True for a throwaway inbox domain, including its subdomains. */
export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    if (DISPOSABLE_DOMAINS.has(parts.slice(i).join("."))) return true;
  }
  return false;
}

/**
 * IPs are stored hashed, never raw. "unknown" is not a key (it would pool
 * everyone), nor is loopback: prod never sees it, and every e2e signup in
 * CI comes from it (CI 09-29 went red on the second one).
 */
export function hashIp(ip: string): string | null {
  if (!ip || ip === "unknown" || /^(127\.|::1$|::ffff:127\.)/.test(ip)) return null;
  return createHash("sha256").update(`cardflip-signup:${ip}`).digest("hex").slice(0, 32);
}

/** The cf_dev cookie from a request, or null. */
export function deviceIdFrom(req: Request): string | null {
  const m = /(?:^|;\s*)cf_dev=([A-Za-z0-9-]{8,64})/.exec(req.headers.get("cookie") ?? "");
  return m ? m[1] : null;
}

export function newDeviceId(): string {
  return randomUUID();
}

/** The hashed inbox a signup belongs to: Gmail dot and plus spellings are one (lib/inboxKey.ts). */
export { inboxKey } from "@/lib/inboxKey";

/**
 * Why this signup gets no free scans, or null when the IP and device are new.
 *
 * With email confirmation on, the free trial goes to the first CONFIRMED
 * account on a device or IP: a signup still waiting on its emailed code (a
 * typo, an abandoned tab) has not used the slot and does not burn it, and one
 * that was deleted before confirming leaves no row at all (users.deleteUser).
 * Confirmed and deleted-after-confirming accounts still count, so deleting
 * and re-signing up does not farm trials. The pending ones are settled when
 * they confirm (emailVerify.markEmailConfirmed). With confirmation off no
 * account is ever pending, so this is the plain one-row-counts rule.
 */
export async function repeatSignup(
  ipHash: string | null,
  deviceId: string | null,
  inbox: string | null = null,
): Promise<"same-device" | "same-ip" | "same-inbox" | null> {
  const counts = (column: "device_id" | "ip_hash" | "inbox_key") =>
    `SELECT 1 FROM signup_log s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.${column} = ? AND (u.id IS NULL OR u.email_pending = 0) LIMIT 1`;
  if (deviceId && (await db.prepare(counts("device_id")).get(deviceId))) {
    return "same-device";
  }
  if (ipHash && (await db.prepare(counts("ip_hash")).get(ipHash))) {
    return "same-ip";
  }
  // The same inbox under another spelling (inboxKey), from any device or network.
  if (inbox && (await db.prepare(counts("inbox_key")).get(inbox))) {
    return "same-inbox";
  }
  return null;
}

/** Vercel's two-letter country for the request, or null (local, unknown). */
export function countryFrom(req: Request): string | null {
  const c = req.headers.get("x-vercel-ip-country")?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

/** Log the signup; a repeat starts with the free trial already spent. */
export async function recordSignup(
  userId: string,
  ipHash: string | null,
  deviceId: string,
  repeat: boolean,
  country: string | null = null,
  now = Date.now(),
  touch: Touch | null = null,
  inbox: string | null = null,
): Promise<void> {
  await db
    .prepare("INSERT INTO signup_log (user_id, ip_hash, device_id, at, country, inbox_key) VALUES (?, ?, ?, ?, ?, ?)")
    .run(userId, ipHash, deviceId, now, country, inbox);
  // Where the signup came from (lib/attribution.ts): its own statement after the
  // guard row, and best effort, so a bad value or a database without the columns
  // can never cost a signup.
  if (touch) {
    try {
      await db
        .prepare("UPDATE signup_log SET src = ?, medium = ?, campaign = ?, landing = ?, ref_host = ? WHERE user_id = ?")
        .run(touch.s, touch.m, touch.c, touch.landing, touch.refHost, userId);
    } catch (err) {
      console.warn("signup attribution skipped", err instanceof Error ? err.message : err);
    }
  }
  if (repeat) await db.prepare("UPDATE users SET trial_scans_used = ? WHERE id = ?").run(TRIAL_SCANS, userId);
}
