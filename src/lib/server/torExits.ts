import "server-only";
import { getSetting, setSetting } from "@/lib/server/settings";

/**
 * Tor exit nodes (10-21, second probe wave: 20 of 22 IPs were Tor exits, a new one every few requests, so no per-IP
 * limit ever added up). The 15-minute uptime cron stores check.torproject.org's list once a day (refreshTorExitsIfDue);
 * ipGate refuses those IPs on every sign-in, sign-up, account and billing route. The firewall rule "Abuse: Tor exits on
 * the API (deny)" holds the 10-21 list; this one never goes stale. A missing or unreadable list refuses nobody.
 */

export const TOR_LIST_URL = "https://check.torproject.org/torbulkexitlist";
export const TOR_SETTING = "tor_exits";
/** A list this short is a broken download, not Tor (1,208 exits on 10-21). */
export const TOR_MIN_EXITS = 300;
const REFRESH_AFTER_MS = 20 * 60 * 60 * 1000;
const MEMO_MS = 60 * 60 * 1000;

interface Stored {
  at: number;
  ips: string[];
}

/** The IPs in a bulk exit list (one a line); anything that is not an IPv4/IPv6 address is skipped. Pure. */
export function parseTorList(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const ip = line.trim().toLowerCase();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || (ip.includes(":") && /^[0-9a-f:]+$/.test(ip))) out.add(ip);
  }
  return [...out];
}

let memo: { at: number; set: Set<string> } | null = null;

/** Tests: forget the per-instance copy. */
export function _resetTorMemo(): void {
  memo = null;
}

async function readStored(): Promise<Stored | null> {
  const raw = await getSetting(TOR_SETTING);
  if (!raw) return null;
  const v = JSON.parse(raw) as Partial<Stored>;
  return Array.isArray(v.ips) && typeof v.at === "number" ? { at: v.at, ips: v.ips } : null;
}

/** True when `ip` is a Tor exit on the stored list. Read once an hour per instance; fails open. */
export async function isTorExit(ip: string, now = Date.now()): Promise<boolean> {
  if (!ip || ip === "unknown") return false;
  try {
    if (!memo || now - memo.at > MEMO_MS) memo = { at: now, set: new Set((await readStored())?.ips ?? []) };
    return memo.set.has(ip.trim().toLowerCase().replace(/^::ffff:/, ""));
  } catch {
    return false;
  }
}

/**
 * Fetch and store the list when the stored one is older than ~a day (or missing). A short or failed download keeps the
 * old list and says why. Never throws.
 */
export async function refreshTorExitsIfDue(
  now = Date.now(),
  fetcher: (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }> = (url) => fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) }),
): Promise<{ refreshed: boolean; exits?: number; error?: string }> {
  try {
    const stored = await readStored().catch(() => null);
    if (stored && now - stored.at < REFRESH_AFTER_MS) return { refreshed: false, exits: stored.ips.length };
    const res = await fetcher(TOR_LIST_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ips = parseTorList(await res.text());
    if (ips.length < TOR_MIN_EXITS) throw new Error(`only ${ips.length} exits in the download`);
    await setSetting(TOR_SETTING, JSON.stringify({ at: now, ips } satisfies Stored));
    memo = { at: now, set: new Set(ips) };
    return { refreshed: true, exits: ips.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`tor exit list: kept the old one (${error})`);
    return { refreshed: false, error };
  }
}
