import "server-only";
import { db } from "@/lib/db";

/**
 * "We'll email you once, when CardFlip opens in your country" (Chris 09-30).
 * One row per email; the first country seen wins (INSERT OR IGNORE), and the
 * country always comes from x-vercel-ip-country, never the form.
 */
export async function joinWaitlist(email: string, country: string | null, ipHash: string | null, now = Date.now()): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO waitlist (email, country, created_at, ip_hash) VALUES (?, ?, ?, ?)")
    .run(email.trim().toLowerCase(), country, now, ipHash);
}

export interface WaitlistSummary {
  total: number;
  byCountry: { country: string; count: number }[];
  recent: { email: string; country: string; createdAt: number }[];
}

export async function waitlistSummary(limit = 200): Promise<WaitlistSummary> {
  const byCountry = (await db
    .prepare("SELECT COALESCE(country, '??') AS country, COUNT(*) AS count FROM waitlist GROUP BY 1 ORDER BY 2 DESC, 1")
    .all()) as { country: string; count: number }[];
  const recent = (await db
    .prepare("SELECT email, COALESCE(country, '??') AS country, created_at AS createdAt FROM waitlist ORDER BY created_at DESC LIMIT ?")
    .all(limit)) as { email: string; country: string; createdAt: number }[];
  return { total: byCountry.reduce((n, r) => n + Number(r.count), 0), byCountry, recent };
}
