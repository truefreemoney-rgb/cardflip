import "server-only";
import { getAppToken } from "@/lib/server/ebay";
import { cachedList } from "@/lib/server/listCache";

/**
 * eBay's daily call caps for OUR app, read from the Developer Analytics API
 * (getRateLimits) and shown on /admin (Chris 10-03: "how bad is eBay going to
 * get hammered with a lot of users?"). Calls are free; the cap is the wall.
 * A new keyset sits on a small default (about 5,000 a day on most selling
 * APIs) until eBay's free application growth check raises it into the
 * millions, so the readout says which side of that line we are on.
 *
 * One app-token call plus one GET, memoed ten minutes (card_cache, SWR) so a
 * busy admin page never adds to the very usage it reports.
 */

export interface EbayLimitRow {
  /** The API's own name ("Inventory", "Fulfillment", "Finances"...). */
  api: string;
  /** The tightest resource of that API: its name, cap, calls left, and when the window resets. */
  resource: string;
  limit: number;
  remaining: number;
  used: number;
  resetAt: number | null;
  /** The window length in seconds (86400 = a day). */
  windowSeconds: number;
}

interface RawRate {
  limit?: number;
  remaining?: number;
  reset?: string;
  timeWindow?: number;
}
interface RawResource {
  name?: string;
  rates?: RawRate[];
}
interface RawApi {
  apiContext?: string;
  apiName?: string;
  apiVersion?: string;
  resources?: RawResource[];
}
export interface RawRateLimits {
  rateLimits?: RawApi[];
}

/** The selling APIs CardFlip actually calls, in the order the tile lists them. */
export const WATCHED_APIS = ["Inventory", "Fulfillment", "Finances", "Account", "Browse", "Marketplace Insights"];

/**
 * One row per watched API: the resource with the least headroom (used ÷
 * limit) decides the row, since that is the one that blocks first. Pure.
 */
export function summarizeRateLimits(json: RawRateLimits, apis: readonly string[] = WATCHED_APIS): EbayLimitRow[] {
  const rows: EbayLimitRow[] = [];
  for (const api of apis) {
    const match = (json.rateLimits ?? []).find((a) => (a.apiName ?? "").toLowerCase() === api.toLowerCase());
    if (!match) continue;
    let best: EbayLimitRow | null = null;
    for (const res of match.resources ?? []) {
      for (const r of res.rates ?? []) {
        const limit = Number(r.limit ?? 0);
        const remaining = Number(r.remaining ?? 0);
        if (!(limit > 0)) continue;
        const row: EbayLimitRow = {
          api,
          resource: res.name ?? "",
          limit,
          remaining,
          used: Math.max(0, limit - remaining),
          resetAt: r.reset ? Date.parse(r.reset) || null : null,
          windowSeconds: Number(r.timeWindow ?? 0),
        };
        if (!best || row.used / row.limit > best.used / best.limit) best = row;
      }
    }
    if (best) rows.push(best);
  }
  return rows;
}

/** Under this daily cap the keyset has not had eBay's growth check yet. */
export const GROWTH_CHECK_LINE = 10_000;

export interface EbayLimitsReport {
  rows: EbayLimitRow[];
  /** When the memo was filled; null when eBay has not answered yet. */
  at: number | null;
  stale: boolean;
  error: string | null;
  /** Why the per-seller half (or the app half) is missing, when it is; shown on the tile so the cause is never only in a log. */
  note: string | null;
}

const KEY = "ebay:rate-limits:v3";
const TTL_MS = 10 * 60 * 1000;

export async function fetchRateLimits(): Promise<RawRateLimits> {
  const token = await getAppToken();
  const res = await fetch("https://api.ebay.com/developer/analytics/v1_beta/rate_limit/", {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`eBay rate_limit ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return (await res.json()) as RawRateLimits;
}

/**
 * The selling APIs (Inventory, Fulfillment, Finances, Account) are called with
 * a SELLER's token and eBay counts them per seller, under getUserRateLimits,
 * not under the app's table (10-03: the first readout showed no Inventory row
 * at all). Read with the owner's own seller token when eBay is connected;
 * those rows are the owner's share, labelled so.
 */
export async function fetchUserRateLimits(userToken: string): Promise<RawRateLimits> {
  const res = await fetch("https://api.ebay.com/developer/analytics/v1_beta/user_rate_limit/", {
    headers: { authorization: `Bearer ${userToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`eBay user_rate_limit ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return (await res.json()) as RawRateLimits;
}

export const SELLER_SUFFIX = " (per seller)";

/** What eBay listed, for the tile's note when none of it matched the names we watch. */
const listed = (json: RawRateLimits): string => (json.rateLimits ?? []).map((a) => `${a.apiContext ?? "?"}/${a.apiName ?? "?"}`).join(", ");

async function readAll(): Promise<{ rows: EbayLimitRow[]; note: string | null }> {
  const appRaw = await fetchRateLimits();
  const app = summarizeRateLimits(appRaw);
  let seller: EbayLimitRow[] = [];
  let sellerNote: string | null = null;
  try {
    const { findUserByEmail, OWNER_EMAIL } = await import("@/lib/server/users");
    const { getUserAccessToken } = await import("@/lib/server/ebayAuth");
    const owner = await findUserByEmail(OWNER_EMAIL);
    const token = owner ? await getUserAccessToken(owner.id) : null;
    if (!token) sellerNote = "Per-seller limits: the owner's eBay connection is not available.";
    else {
      const raw = await fetchUserRateLimits(token);
      seller = summarizeRateLimits(raw).map((r) => ({ ...r, api: `${r.api}${SELLER_SUFFIX}` }));
      if (seller.length === 0) sellerNote = `Per-seller limits: eBay listed ${listed(raw) || "nothing"}.`;
    }
  } catch (err) {
    sellerNote = `Per-seller limits unavailable: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200);
  }
  if (app.length === 0) sellerNote = `${sellerNote ?? ""} App limits: eBay listed ${listed(appRaw) || "nothing"}.`.trim();
  // Seller-token APIs first (they are the ones a busy site spends), then the app's own.
  return { rows: [...seller, ...app.filter((a) => !seller.some((s) => s.api === `${a.api}${SELLER_SUFFIX}`))], note: sellerNote };
}

/** Memoed ten minutes; a fetch that fails answers with the error and an empty table, never a blank page. */
export async function ebayRateLimits(now = Date.now()): Promise<EbayLimitsReport> {
  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) return { rows: [], at: null, stale: false, error: "eBay keys are not configured here", note: null };
  try {
    const value = await cachedList<{ rows: EbayLimitRow[]; note: string | null; at: number }>(KEY, TTL_MS, async () => ({ ...(await readAll()), at: Date.now() }), now);
    return { rows: value.rows, at: value.at, stale: now - value.at > TTL_MS, error: null, note: value.note ?? null };
  } catch (err) {
    return { rows: [], at: null, stale: false, error: err instanceof Error ? err.message : String(err), note: null };
  }
}
