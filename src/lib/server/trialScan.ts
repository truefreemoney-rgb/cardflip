import "server-only";
import { db } from "@/lib/db";

/**
 * The ad landing page's free scan (10-05, /scan): no account, one card. A
 * read that misses (glare, wrong card) may be retaken, so the cap is a few
 * paid reads per device and per network over a month, not one; the page
 * itself stops offering the camera after the first card it prices. Every
 * read is also counted against a site-wide daily budget in the route.
 */
export const TRIAL_TRIES = 3;
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** True when this device or network has used its tries. */
export async function trialScanUsedUp(deviceId: string, ipHash: string | null, now = Date.now()): Promise<boolean> {
  const since = now - WINDOW_MS;
  const byDevice = (await db
    .prepare("SELECT COUNT(*) AS n FROM trial_scans WHERE device_id = ? AND at > ?")
    .get(deviceId, since)) as { n: number } | undefined;
  if (Number(byDevice?.n ?? 0) >= TRIAL_TRIES) return true;
  if (!ipHash) return false;
  const byIp = (await db
    .prepare("SELECT COUNT(*) AS n FROM trial_scans WHERE ip_hash = ? AND at > ?")
    .get(ipHash, since)) as { n: number } | undefined;
  return Number(byIp?.n ?? 0) >= TRIAL_TRIES;
}

/** Counted before the paid call, like dayBudget: a failed read still spent a try. */
export async function recordTrialScan(deviceId: string, ipHash: string | null, now = Date.now()): Promise<void> {
  await db.prepare("INSERT INTO trial_scans (device_id, ip_hash, at) VALUES (?, ?, ?)").run(deviceId, ipHash, now);
}
