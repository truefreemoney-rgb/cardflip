import "server-only";
import { db } from "@/lib/db";

/**
 * The /scan vs home split test (10-06, Chris: "we should split test scan and homepage"), read for
 * /admin/adtest. One row per landing page x source. Google Ads rotates two ads evenly, one linking to
 * /scan and one to /, so each page gets about half the clicks.
 *
 * A visitor is page_views' daily key (day + visitor hash). Their landing is the first page they loaded
 * that day with a source on it (only a page load's first ping carries src). The steps are the
 * one-row-per-visitor-per-day funnel pings: /scan/<step> from TrialScanner, /home/<step> from
 * LandingSteps + TrialCta. Accounts come from signup_log (the browser's first touch: source + landing),
 * so they are counted by signup time, not joined to the visitor key. Paid = a live subscription or a
 * Booster bought. Read-only; a missing table or column reads as zero.
 */

export const AD_SOURCES = ["googleads", "tiktok", "other"] as const;
export type AdSource = (typeof AD_SOURCES)[number];
export const LANDINGS = ["/scan", "/"] as const;
export type Landing = (typeof LANDINGS)[number];

export interface AdTestRow {
  landing: Landing;
  source: AdSource;
  visitors: number;
  stay10: number;
  tapped: number;
  /** Priced a card (a chip, a search pick or a scan): /scan only, null on home (home has no price step). */
  priced: number | null;
  /** Tapped a signup button on the page. */
  signupTap: number;
  /** Loaded /signup the same day. */
  signupPage: number;
  accounts: number;
  paid: number;
}

const SRC_BUCKET = "CASE WHEN src = 'googleads' THEN 'googleads' WHEN src = 'tiktok' THEN 'tiktok' ELSE 'other' END";

/** The last `hours` up to now. */
export async function getAdTest(hours: number, end = Date.now()): Promise<AdTestRow[]> {
  const since = end - hours * 3_600_000;
  const rows: AdTestRow[] = [];
  for (const landing of LANDINGS) for (const source of AD_SOURCES) rows.push({ landing, source, visitors: 0, stay10: 0, tapped: 0, priced: landing === "/scan" ? 0 : null, signupTap: 0, signupPage: 0, accounts: 0, paid: 0 });
  const find = (landing: string, source: string) => rows.find((r) => r.landing === landing && r.source === source);

  try {
    // SQLite: the bare columns of a MIN() aggregate come from the row holding the minimum.
    const visits = (await db
      .prepare(
        `WITH first AS (
           SELECT day, visitor, path, ${SRC_BUCKET} AS source, MIN(at) AS at
           FROM page_views WHERE at >= ? AND at < ? AND src IS NOT NULL AND src <> ''
           GROUP BY day, visitor
         ), land AS (
           SELECT day, visitor, path, source, CASE path WHEN '/scan' THEN '/scan' ELSE '/home' END AS pre
           FROM first WHERE path IN ('/', '/scan')
         )
         SELECT path, source, COUNT(*) AS visitors,
           SUM(EXISTS(SELECT 1 FROM page_views p WHERE p.day = land.day AND p.visitor = land.visitor AND p.path = land.pre || '/stay10')) AS stay10,
           SUM(EXISTS(SELECT 1 FROM page_views p WHERE p.day = land.day AND p.visitor = land.visitor AND p.path = land.pre || '/tap')) AS tapped,
           SUM(EXISTS(SELECT 1 FROM page_views p WHERE p.day = land.day AND p.visitor = land.visitor AND p.path = '/scan/price')) AS priced,
           SUM(EXISTS(SELECT 1 FROM page_views p WHERE p.day = land.day AND p.visitor = land.visitor AND p.path = land.pre || '/signup')) AS signupTap,
           SUM(EXISTS(SELECT 1 FROM page_views p WHERE p.day = land.day AND p.visitor = land.visitor AND p.path = '/signup')) AS signupPage
         FROM land GROUP BY path, source`,
      )
      .all(since, end)) as unknown as { path: string; source: string; visitors: number; stay10: number; tapped: number; priced: number; signupTap: number; signupPage: number }[];
    for (const v of visits) {
      const r = find(v.path, v.source);
      if (!r) continue;
      r.visitors = Number(v.visitors) || 0;
      r.stay10 = Number(v.stay10) || 0;
      r.tapped = Number(v.tapped) || 0;
      if (r.priced !== null) r.priced = Number(v.priced) || 0;
      r.signupTap = Number(v.signupTap) || 0;
      r.signupPage = Number(v.signupPage) || 0;
    }
  } catch (err) {
    console.warn("adtest visits", err instanceof Error ? err.message : err);
  }

  try {
    const signups = (await db
      .prepare(
        `SELECT s.landing AS landing, ${SRC_BUCKET.replaceAll("src", "s.src")} AS source, COUNT(*) AS accounts,
           SUM(u.sub_status IN ('active', 'trialing', 'past_due') OR EXISTS(SELECT 1 FROM scan_pack_purchases b WHERE b.user_id = s.user_id)) AS paid
         FROM signup_log s LEFT JOIN users u ON u.id = s.user_id
         WHERE s.at >= ? AND s.at < ? AND s.landing IN ('/', '/scan')
         GROUP BY s.landing, source`,
      )
      .all(since, end)) as unknown as { landing: string; source: string; accounts: number; paid: number }[];
    for (const s of signups) {
      const r = find(s.landing, s.source);
      if (!r) continue;
      r.accounts = Number(s.accounts) || 0;
      r.paid = Number(s.paid) || 0;
    }
  } catch (err) {
    console.warn("adtest signups", err instanceof Error ? err.message : err);
  }
  return rows;
}
