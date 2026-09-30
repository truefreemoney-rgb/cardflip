import "server-only";
import { db } from "@/lib/db";
import { errorCount24h, errorGroups24h, type ErrorGroup } from "@/lib/server/errorLog";
import { daysUntil, loadExpenses, monthlyTotal, nextDue } from "@/lib/server/expenses";
import { eastern, LAST_POST_PREFIX } from "@/lib/server/socialPublish";
import { SOCIAL_SITES } from "@/lib/server/socialSites";
import { PRICING } from "@/lib/pricing";

/**
 * The "pulse" half of /admin (09-27): what needs Chris today. Support
 * tickets, money, the robots (social, daily job, errors). The platform
 * counts and 30-day charts stay in adminStats.getAdminOverview; this file
 * only adds the rows the console gained since the overview was written
 * (tickets, help chat, subscriptions, expenses, social). Every query is
 * wrapped so one slow table degrades to a zero, never a blank page.
 */

const DAY_MS = 86_400_000;

/**
 * Countries whose sellers could list on their own eBay site
 * (docs/EBAY_COUNTRIES_PLAN.md). NZ is deliberately absent: it stays on eBay US
 * until a NZ seller tests it. Mirrors LOCAL_MARKET_COUNTRIES in lib/marketplaces.ts.
 */
const LOCAL_TESTER_COUNTRIES = ["CA", "GB", "IE", "AU"];
/** A connect stays a "Needs you" row for this long. */
const LOCAL_TESTER_WINDOW_MS = 14 * DAY_MS;

/** The overview row for sellers from a local-market country who connected eBay. */
export function localTesterText(country: string, sellers: number): string {
  return sellers === 1
    ? `Seller from ${country} connected eBay — first local-market tester`
    : `${sellers} sellers from ${country} connected eBay — local-market testers`;
}

export interface PulseTicket {
  id: string;
  number: number;
  subject: string;
  userName: string;
  createdAt: number;
  updatedAt: number;
  /** True when the seller spoke last (or nobody has replied yet). */
  needsReply: boolean;
}

export interface OverviewPulse {
  now: number;
  support: {
    open: number;
    needsReply: number;
    closed7d: number;
    /** Oldest unanswered open ticket, ms since it was last touched by the seller. */
    oldestWaitingMs: number | null;
    recent: PulseTicket[];
    helpMessages24h: number;
  };
  money: {
    mrrUsd: number;
    activeStandard: number;
    activePro: number;
    pastDue: number;
    costsMonthlyUsd: number;
    unconfirmedCosts: number;
    nextBill: { name: string; day: string; days: number; amountUsd: number } | null;
  };
  social: {
    /** Eastern day the robots post against. */
    today: string;
    sites: { id: string; label: string; connected: boolean; lastDay: string | null; postedToday: boolean }[];
  };
  errors: { last24h: number; groups: ErrorGroup[] };
  /** Sellers whose home country is CA/GB/IE/AU and who connected eBay in the last 14 days, by country. */
  localTesters: { country: string; sellers: number }[];
}

async function scalar(sql: string, ...args: (string | number)[]): Promise<number> {
  try {
    const row = (await db.prepare(sql).get(...args)) as { n: number } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}
async function rows<T>(sql: string, ...args: (string | number)[]): Promise<T[]> {
  try {
    return (await db.prepare(sql).all(...args)) as unknown as T[];
  } catch {
    return [];
  }
}

export async function getOverviewPulse(now = Date.now()): Promise<OverviewPulse> {
  const week = now - 7 * DAY_MS;
  const day = now - DAY_MS;

  const [openRows, closed7d, helpMessages24h, subRows, expenses, errors24h, groups, socialRows, testerRows] = await Promise.all([
    // Every open ticket with who spoke last; the page keeps the first few.
    rows<{ id: string; number: number; subject: string; user_name: string | null; created_at: number; updated_at: number; last_author: string | null }>(
      `SELECT t.id, t.number, t.subject, u.name AS user_name, t.created_at, t.updated_at,
              (SELECT n.author FROM support_ticket_notes n WHERE n.ticket_id = t.id ORDER BY n.created_at DESC LIMIT 1) AS last_author
         FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id
        WHERE t.status = 'open'
        ORDER BY t.updated_at DESC LIMIT 200`,
    ),
    scalar("SELECT COUNT(*) AS n FROM support_tickets WHERE status = 'closed' AND closed_at >= ?", week),
    scalar("SELECT COUNT(*) AS n FROM help_messages WHERE role = 'user' AND created_at >= ?", day),
    rows<{ plan: string; status: string; users: number }>(
      "SELECT COALESCE(plan, 'standard') AS plan, sub_status AS status, COUNT(*) AS users FROM users WHERE sub_status IS NOT NULL GROUP BY 1, 2",
    ),
    loadExpenses().catch(() => []),
    errorCount24h(),
    errorGroups24h(3),
    rows<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key LIKE ?", `${LAST_POST_PREFIX}%`),
    rows<{ country: string; n: number }>(
      `SELECT u.home_country AS country, COUNT(*) AS n
         FROM ebay_tokens t JOIN users u ON u.id = t.user_id
        WHERE u.home_country IN (${LOCAL_TESTER_COUNTRIES.map(() => "?").join(", ")}) AND t.connected_at >= ?
        GROUP BY u.home_country ORDER BY n DESC, u.home_country`,
      ...LOCAL_TESTER_COUNTRIES,
      now - LOCAL_TESTER_WINDOW_MS,
    ),
  ]);

  const tickets: PulseTicket[] = openRows.map((r) => ({
    id: r.id,
    number: Number(r.number),
    subject: r.subject,
    userName: r.user_name ?? "",
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    needsReply: r.last_author !== "admin",
  }));
  const waiting = tickets.filter((t) => t.needsReply);
  const oldestWaiting = waiting.reduce<number | null>((min, t) => (min === null || t.updatedAt < min ? t.updatedAt : min), null);

  const sum = (pred: (r: { plan: string; status: string }) => boolean) =>
    subRows.filter(pred).reduce((a, r) => a + Number(r.users), 0);
  const live = (s: string) => s === "active" || s === "trialing";
  const activeStandard = sum((r) => r.plan === "standard" && live(r.status));
  const activePro = sum((r) => r.plan === "pro" && live(r.status));

  const upcoming = expenses
    .filter((e) => e.period !== "once")
    .map((e) => ({ e, day: nextDue(e) }))
    .filter((x): x is { e: (typeof expenses)[number]; day: string } => x.day !== null)
    .sort((x, y) => x.day.localeCompare(y.day))[0];

  const lastDay = new Map<string, string>();
  for (const r of socialRows) {
    const rest = r.key.slice(LAST_POST_PREFIX.length);
    if (!rest.includes(":")) lastDay.set(rest, r.value);
  }
  const today = eastern(now).day;

  return {
    now,
    support: {
      open: tickets.length,
      needsReply: waiting.length,
      closed7d,
      oldestWaitingMs: oldestWaiting === null ? null : now - oldestWaiting,
      // Unanswered first, then the rest, newest activity on top.
      recent: [...waiting, ...tickets.filter((t) => !t.needsReply)].slice(0, 5),
      helpMessages24h,
    },
    money: {
      mrrUsd: activeStandard * PRICING.standard.price + activePro * PRICING.pro.price,
      activeStandard,
      activePro,
      pastDue: sum((r) => r.status === "past_due"),
      costsMonthlyUsd: Math.round(monthlyTotal(expenses) * 100) / 100,
      unconfirmedCosts: expenses.filter((e) => !e.confirmed).length,
      nextBill: upcoming ? { name: upcoming.e.name, day: upcoming.day, days: daysUntil(upcoming.day), amountUsd: upcoming.e.amountUsd } : null,
    },
    social: {
      today,
      sites: SOCIAL_SITES.map((s) => {
        let connected = false;
        try { connected = s.connected(); } catch { /* env read failed */ }
        const last = lastDay.get(s.id) ?? null;
        return { id: s.id, label: s.label, connected, lastDay: last, postedToday: last === today };
      }),
    },
    errors: { last24h: errors24h, groups },
    localTesters: testerRows.map((r) => ({ country: r.country, sellers: Number(r.n) })),
  };
}
