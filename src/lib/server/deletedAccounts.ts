import "server-only";
import { db } from "@/lib/db";
import { PRICING } from "@/lib/pricing";
import type { ScanTier } from "@/lib/server/users";

/** appleIap.ts SANDBOX_KEY_PREFIX (kept here so the admin page does not load Apple's library, like analytics.ts). */
const SANDBOX = "apple-sandbox:";
/** What one subscription payment brings in, by plan (as analytics.ts PLAN_USD). */
const PLAN_USD = { standard: PRICING.standard.price, pro: PRICING.pro.price } as const;
/** Account ids are UUIDs; the ledgers also hold made-up ids (the landing page's "trial-scan"). */
const UUID_GLOB = "????????-????-????-????-????????????";
const LIMIT = 500;

export interface DeletedAccount {
  id: string;
  /** null: deleted before deleted_accounts existed (10-31), so only the kept ledgers know the account. */
  deletedAt: number | null;
  /** When the account was made: the row, else the signup log. */
  createdAt: number | null;
  by: "self" | "admin" | null;
  via: "app" | "web" | null;
  tier: ScanTier | null;
  plan: "standard" | "pro" | null;
  subSource: "stripe" | "apple" | null;
  /** false: the email was never confirmed (could not scan). */
  confirmed: boolean | null;
  cards: number | null;
  /** Scanner reads (locate and tiebreak calls left out, as activeUsers.ts). */
  scans: number;
  scanCostMicros: number;
  lastScanAt: number | null;
  boosters: number;
  testBoosters: number;
  subPayments: number;
  testSubPayments: number;
  /** Real money in: Boosters plus subscription payments (Apple sandbox = $0). */
  paidUsd: number;
}

type Row = Record<string, unknown>;
const n = (v: unknown): number => Number(v ?? 0) || 0;

/**
 * /admin/users/deleted (Chris 10-31: "we are going to need a section for deleted accounts"). Accounts deleted since
 * 10-31 have a deleted_accounts row (users.ts deleteUser); older ones are found the only way left, by ids in the kept
 * ledgers (signup_log, scan_usage, scan_pack_purchases, scan_credits) that no account answers any more. Never a name
 * or an email: none is kept (the privacy page).
 */
export async function listDeletedAccounts(): Promise<{ accounts: DeletedAccount[]; now: number }> {
  const now = Date.now();
  return { accounts: await readDeletedAccounts(), now };
}

async function readDeletedAccounts(): Promise<DeletedAccount[]> {
  const recorded = (await db.prepare("SELECT * FROM deleted_accounts ORDER BY deleted_at DESC LIMIT ?").all(LIMIT)) as Row[];
  const older = (await db
    .prepare(
      `SELECT DISTINCT o.id FROM (
         SELECT user_id AS id FROM signup_log
         UNION SELECT user_id FROM scan_pack_purchases
         UNION SELECT user_id FROM scan_credits
         UNION SELECT DISTINCT user_id FROM scan_usage
       ) o
       WHERE o.id GLOB '${UUID_GLOB}'
         AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = o.id)
         AND NOT EXISTS (SELECT 1 FROM deleted_accounts d WHERE d.user_id = o.id)
       LIMIT ?`,
    )
    .all(LIMIT)) as Row[];
  const ids = [...recorded.map((r) => String(r.user_id)), ...older.map((r) => String(r.id))];
  if (ids.length === 0) return [];
  const marks = ids.map(() => "?").join(", ");
  const byId = async (sql: string): Promise<Map<string, Row>> =>
    new Map(((await db.prepare(sql.replace("(:ids)", `(${marks})`)).all(...ids)) as Row[]).map((r) => [String(r.user_id), r]));
  const [scans, packs, credits, signups] = await Promise.all([
    byId(
      `SELECT user_id, COUNT(*) AS scans, COALESCE(SUM(cost_micros), 0) AS cost, MAX(at) AS last FROM scan_usage
        WHERE user_id IN (:ids) AND (read IS NULL OR (read NOT LIKE '{"locate":%' AND read NOT LIKE '%"tiebreak":%'))
        GROUP BY user_id`,
    ),
    byId(`SELECT user_id, SUM(session_id NOT LIKE '${SANDBOX}%') AS real, SUM(session_id LIKE '${SANDBOX}%') AS test FROM scan_pack_purchases WHERE user_id IN (:ids) GROUP BY user_id`),
    byId(
      `SELECT user_id, SUM(credit_key NOT LIKE '${SANDBOX}%') AS real, SUM(credit_key LIKE '${SANDBOX}%') AS test,
              COALESCE(SUM(CASE WHEN credit_key LIKE '${SANDBOX}%' THEN 0 WHEN plan = 'pro' THEN ${PLAN_USD.pro} ELSE ${PLAN_USD.standard} END), 0) AS usd
         FROM scan_credits WHERE user_id IN (:ids) AND kind = 'payment' GROUP BY user_id`,
    ),
    byId(`SELECT user_id, at FROM signup_log WHERE user_id IN (:ids)`),
  ]);
  const rec = new Map(recorded.map((r) => [String(r.user_id), r]));
  const out = ids.map((id): DeletedAccount => {
    const r = rec.get(id);
    const s = scans.get(id);
    const p = packs.get(id);
    const c = credits.get(id);
    const boosters = n(p?.real);
    return {
      id,
      deletedAt: r ? n(r.deleted_at) : null,
      createdAt: r?.created_at != null ? n(r.created_at) : signups.get(id)?.at != null ? n(signups.get(id)?.at) : null,
      by: r?.deleted_by === "self" || r?.deleted_by === "admin" ? r.deleted_by : null,
      via: r?.via === "app" || r?.via === "web" ? r.via : null,
      tier: r?.tier ? (String(r.tier) as ScanTier) : null,
      plan: r?.plan === "pro" || r?.plan === "standard" ? r.plan : null,
      subSource: r?.sub_source === "apple" || r?.sub_source === "stripe" ? r.sub_source : null,
      confirmed: r?.confirmed == null ? null : n(r.confirmed) === 1,
      cards: r?.cards == null ? null : n(r.cards),
      scans: n(s?.scans),
      scanCostMicros: n(s?.cost),
      lastScanAt: s?.last != null ? n(s.last) : null,
      boosters,
      testBoosters: n(p?.test),
      subPayments: n(c?.real),
      testSubPayments: n(c?.test),
      paidUsd: boosters * PRICING.pack.price + n(c?.usd),
    };
  });
  // Newest delete first; the unrecorded older ones after, by their last scan / signup.
  return out.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0) || (b.lastScanAt ?? b.createdAt ?? 0) - (a.lastScanAt ?? a.createdAt ?? 0));
}
