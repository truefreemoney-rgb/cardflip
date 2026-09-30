import "server-only";
import { db } from "@/lib/db";
import { etDayStart } from "@/lib/time";
import { fromRow, OWNER_EMAIL, planOf, scanTier, type Plan, type ScanTier, type UserRow } from "@/lib/server/users";

/**
 * Admin → Users → Active Users (Chris 09-30: "add a active users tab to the
 * users section in admin"). A seller is active in a window when their
 * latest signal falls inside it. Two kinds of signal:
 *  - opened the app: users.last_seen_at, the /api/auth/me heartbeat
 *    (users.ts markSeen, 10-minute grain);
 *  - did something: a scan, a price check, a saved card, a watchlist add,
 *    a help chat question, a support ticket or a seller note on one.
 * Deliberately not counted: cards.updated_at (the daily price jobs write it
 * for sellers who never open the app, which was the old Active column's
 * bug), ebay_tokens.updated_at, the signup session, and page_views (no
 * user id). Staff (role admin, or the owner's email) are left out and only
 * counted, because the owner's own test scans would top the list. Deleted
 * accounts drop out at the JOIN; scan_usage keeps their rows on purpose.
 *
 * Blind spots: a PWA left open all day counts once, when it was opened;
 * deleting a card or a price check deletes that evidence; accounts from
 * before 09-30 show only their action signals until they next open the app.
 */

export type ActiveWindow = "today" | "7d" | "30d";

/** Pill order on the page. "Today" is the Eastern calendar day. */
export const ACTIVE_WINDOWS: readonly { id: ActiveWindow; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 Days" },
  { id: "30d", label: "30 Days" },
];

export type ActiveSignal =
  | "Opened the App"
  | "Scanned"
  | "Checked a Price"
  | "Saved a Card"
  | "Added to Watchlist"
  | "Used Help Chat"
  | "Wrote to Support";

export interface ActiveUser {
  id: string;
  name: string;
  email: string;
  tier: ScanTier;
  /** The paid plan when the tier is subscribed, else null. */
  plan: Plan | null;
  /** The latest signal in the last 30 days, and what it was. */
  activeAt: number;
  what: ActiveSignal;
  /** Scanner reads (scan_usage rows, locate and tiebreak calls left out) inside each window. */
  scans: Record<ActiveWindow, number>;
}

export interface ActiveUsersSnapshot {
  now: number;
  /** Where each window starts (inclusive): Eastern midnight, now - 7 days, now - 30 days. */
  since: Record<ActiveWindow, number>;
  /** Everyone active in the last 30 days, latest first, staff left out. */
  users: ActiveUser[];
  /** Latest-signal times of the staff accounts left out, for "N staff hidden". */
  staffAt: number[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function windowStarts(now: number): Record<ActiveWindow, number> {
  return { today: etDayStart(now), "7d": now - 7 * DAY_MS, "30d": now - 30 * DAY_MS };
}

/** ?window= → a window; anything else is the 7 Days default. */
export function parseActiveWindow(raw: string | undefined): ActiveWindow {
  return raw === "today" || raw === "30d" ? raw : "7d";
}

// One statement, one round trip. Every branch is bounded by the 30-day
// start. scan_usage is the one ledger that grows with every scan, so it is
// pinned to its time index (a bare plan walked the whole table through
// idx_scan_usage_user) and read once: the same pass gives the Scanned
// signal and the per-window scan counts. Its multi-card locate and picture
// tiebreak rows are extra vision calls, not scans, so they are skipped
// (matched with LIKE: `read` is cut at 2000 characters, which json_extract
// would reject). SQLite takes the bare `what` column from the row that
// holds MAX(at).
const ACTIVE_SQL = `
WITH scans AS (
  SELECT user_id, MAX(at) AS at, SUM(at >= ?) AS today, SUM(at >= ?) AS week, COUNT(*) AS month
    FROM scan_usage INDEXED BY idx_scan_usage_at
   WHERE at >= ?
     AND (read IS NULL OR (read NOT LIKE '{"locate":%' AND read NOT LIKE '%"tiebreak":%'))
   GROUP BY user_id
), sig(user_id, at, what) AS (
  SELECT id, last_seen_at, 'Opened the App' FROM users WHERE last_seen_at >= ?
  UNION ALL SELECT user_id, at, 'Scanned' FROM scans
  UNION ALL SELECT user_id, MAX(checked_at), 'Checked a Price' FROM price_checks WHERE checked_at >= ? GROUP BY user_id
  UNION ALL SELECT user_id, MAX(created_at), 'Saved a Card' FROM cards WHERE created_at >= ? GROUP BY user_id
  UNION ALL SELECT user_id, MAX(added_at), 'Added to Watchlist' FROM wishlist_items WHERE added_at >= ? GROUP BY user_id
  UNION ALL SELECT user_id, MAX(created_at), 'Used Help Chat' FROM help_messages WHERE role = 'user' AND created_at >= ? GROUP BY user_id
  UNION ALL SELECT user_id, MAX(created_at), 'Wrote to Support' FROM support_tickets WHERE created_at >= ? GROUP BY user_id
  UNION ALL SELECT user_id, MAX(created_at), 'Wrote to Support' FROM support_ticket_notes WHERE author = 'seller' AND created_at >= ? GROUP BY user_id
), latest AS (
  SELECT user_id, MAX(at) AS at, what FROM sig GROUP BY user_id
)
SELECT u.*, latest.at AS active_at, latest.what AS active_what,
       COALESCE(scans.today, 0) AS scans_today, COALESCE(scans.week, 0) AS scans_week, COALESCE(scans.month, 0) AS scans_month
  FROM latest
  JOIN users u ON u.id = latest.user_id
  LEFT JOIN scans ON scans.user_id = latest.user_id
 ORDER BY latest.at DESC
 LIMIT 500`;

type ActiveRow = UserRow & {
  active_at: number;
  active_what: ActiveSignal;
  scans_today: number;
  scans_week: number;
  scans_month: number;
};

function isStaff(u: { role: string; email: string }): boolean {
  return u.role === "admin" || u.email.toLowerCase() === OWNER_EMAIL;
}

/** The last 30 days, straight from the database. The page reads activeUsers() instead. */
export async function loadActiveUsers(now = Date.now()): Promise<ActiveUsersSnapshot> {
  const since = windowStarts(now);
  const from = since["30d"];
  const rows = (await db
    .prepare(ACTIVE_SQL)
    .all(since.today, since["7d"], from, from, from, from, from, from, from, from)) as unknown as ActiveRow[];
  const users: ActiveUser[] = [];
  const staffAt: number[] = [];
  for (const row of rows) {
    const u = fromRow(row);
    const activeAt = Number(row.active_at);
    if (isStaff(u)) {
      staffAt.push(activeAt);
      continue;
    }
    const tier = scanTier(u);
    users.push({
      id: u.id,
      name: u.name,
      email: u.email,
      tier,
      plan: tier === "subscribed" ? planOf(u) : null,
      activeAt,
      what: row.active_what,
      scans: { today: Number(row.scans_today), "7d": Number(row.scans_week), "30d": Number(row.scans_month) },
    });
  }
  return { now, since, users, staffAt };
}

// A 60 s memo per instance caps the walk (cards, help_messages and the
// small tables have no time index) at one a minute however often the page
// is refreshed. Module memory, not card_cache, so no email lands in the DB.
const MEMO_MS = 60_000;
let memo: ActiveUsersSnapshot | null = null;

export async function activeUsers(now = Date.now()): Promise<ActiveUsersSnapshot> {
  if (memo && now >= memo.now && now - memo.now < MEMO_MS) return memo;
  memo = await loadActiveUsers(now);
  return memo;
}

/** The rows and the staff count for one window. */
export function activeIn(snap: ActiveUsersSnapshot, win: ActiveWindow): { users: ActiveUser[]; staffHidden: number } {
  const from = snap.since[win];
  return {
    users: snap.users.filter((u) => u.activeAt >= from),
    staffHidden: snap.staffAt.filter((at) => at >= from).length,
  };
}
