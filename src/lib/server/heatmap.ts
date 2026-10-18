import { db } from "@/lib/db";
import { type HeatDevice, pageLabel } from "@/lib/heatmap";

/**
 * Reads for /admin/heatmap (10-18, lib/heatmap.ts). Everything is counted
 * within one device (phone or computer: the layouts differ, so their taps
 * cannot share a picture) and one time window. A view "left the site" when
 * its tab has no next view (a tab still open counts as left until it moves).
 */

export interface PageRow {
  page: string;
  label: string;
  views: number;
  /** Views that were the last page of their visit. */
  exits: number;
  /** Average furthest scroll, % of the page. */
  depth: number;
}

export interface Count {
  label: string;
  n: number;
}

export interface Tap {
  x: number;
  y: number;
  h: number;
  fixed: number;
}

export interface PageDetail {
  page: string;
  label: string;
  views: number;
  /** The page address the preview shows: the one most visited under this map. */
  samplePath: string;
  taps: Tap[];
  tapCount: number;
  /** Taps on nothing tappable (dead taps): a sign people expected something to happen. */
  deadTaps: number;
  topLabels: Count[];
  next: Count[];
  previous: Count[];
  /** % of views that scrolled at least to each mark. */
  reach: { mark: number; pct: number }[];
}

export interface Heatmap {
  device: HeatDevice;
  visits: number;
  /** Visits that saw one page and left. */
  oneAndDone: number;
  pageViews: number;
  pages: PageRow[];
  steps: { from: string; to: string; n: number }[];
  detail: PageDetail | null;
}

/** Up to this many taps are drawn; the newest win. */
const TAP_CAP = 6000;
const LEFT = "Left CardFlip";
const FIRST = "Arrived here first";

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    // A database from before the heat tables shows an empty page, not an error.
    return fallback;
  }
}

export async function getHeatmap(since: number, end: number, device: HeatDevice, page: string | null): Promise<Heatmap> {
  const win = [since, end, device] as const;
  const [totals, oneAndDone, pageRows, stepRows] = await Promise.all([
    safe(db.prepare("SELECT COUNT(*) AS views, COUNT(DISTINCT tab) AS visits FROM heat_views WHERE at >= ? AND at < ? AND device = ?").get<{ views: number; visits: number }>(...win), undefined),
    safe(
      db
        .prepare("SELECT COUNT(*) AS n FROM (SELECT tab FROM heat_views WHERE at >= ? AND at < ? AND device = ? GROUP BY tab HAVING COUNT(*) = 1)")
        .get<{ n: number }>(...win),
      undefined,
    ),
    safe(
      db
        .prepare(
          `SELECT v.page AS page, COUNT(*) AS views, SUM(CASE WHEN n.tab IS NULL THEN 1 ELSE 0 END) AS exits, AVG(v.depth) AS depth
             FROM heat_views v LEFT JOIN heat_views n ON n.tab = v.tab AND n.seq = v.seq + 1
            WHERE v.at >= ? AND v.at < ? AND v.device = ?
            GROUP BY v.page ORDER BY views DESC LIMIT 40`,
        )
        .all<{ page: string; views: number; exits: number; depth: number | null }>(...win),
      [],
    ),
    safe(
      db
        .prepare(
          `SELECT v.page AS a, n.page AS b, COUNT(*) AS n
             FROM heat_views v JOIN heat_views n ON n.tab = v.tab AND n.seq = v.seq + 1
            WHERE v.at >= ? AND v.at < ? AND v.device = ? AND n.page <> v.page
            GROUP BY v.page, n.page ORDER BY n DESC LIMIT 12`,
        )
        .all<{ a: string; b: string; n: number }>(...win),
      [],
    ),
  ]);
  const pages: PageRow[] = pageRows.map((r) => ({
    page: r.page,
    label: pageLabel(r.page),
    views: Number(r.views),
    exits: Number(r.exits),
    depth: Math.round(Number(r.depth ?? 0)),
  }));
  const chosen = page && pages.some((p) => p.page === page) ? page : (pages[0]?.page ?? null);
  return {
    device,
    visits: Number(totals?.visits ?? 0),
    oneAndDone: Number(oneAndDone?.n ?? 0),
    pageViews: Number(totals?.views ?? 0),
    pages,
    steps: stepRows.map((r) => ({ from: pageLabel(r.a), to: pageLabel(r.b), n: Number(r.n) })),
    detail: chosen ? await pageDetail(since, end, device, chosen) : null,
  };
}

async function pageDetail(since: number, end: number, device: HeatDevice, page: string): Promise<PageDetail> {
  const args = [since, end, device, page] as const;
  const [sample, taps, tapTotals, labels, next, prev, reach] = await Promise.all([
    safe(
      db
        .prepare("SELECT path, COUNT(*) AS n FROM heat_views WHERE at >= ? AND at < ? AND device = ? AND page = ? GROUP BY path ORDER BY n DESC LIMIT 1")
        .get<{ path: string }>(...args),
      undefined,
    ),
    safe(
      db
        .prepare(`SELECT x, y, h, fixed FROM heat_taps WHERE at >= ? AND at < ? AND device = ? AND page = ? ORDER BY at DESC LIMIT ${TAP_CAP}`)
        .all<Tap>(...args),
      [],
    ),
    safe(
      db
        .prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN label = '' THEN 1 ELSE 0 END) AS dead FROM heat_taps WHERE at >= ? AND at < ? AND device = ? AND page = ?")
        .get<{ n: number; dead: number | null }>(...args),
      undefined,
    ),
    safe(
      db
        .prepare("SELECT label, COUNT(*) AS n FROM heat_taps WHERE at >= ? AND at < ? AND device = ? AND page = ? AND label <> '' GROUP BY label ORDER BY n DESC LIMIT 15")
        .all<{ label: string; n: number }>(...args),
      [],
    ),
    safe(
      db
        .prepare(
          `SELECT n.page AS page, COUNT(*) AS n
             FROM heat_views v LEFT JOIN heat_views n ON n.tab = v.tab AND n.seq = v.seq + 1
            WHERE v.at >= ? AND v.at < ? AND v.device = ? AND v.page = ?
            GROUP BY n.page ORDER BY n DESC LIMIT 10`,
        )
        .all<{ page: string | null; n: number }>(...args),
      [],
    ),
    safe(
      db
        .prepare(
          `SELECT p.page AS page, COUNT(*) AS n
             FROM heat_views v LEFT JOIN heat_views p ON p.tab = v.tab AND p.seq = v.seq - 1
            WHERE v.at >= ? AND v.at < ? AND v.device = ? AND v.page = ?
            GROUP BY p.page ORDER BY n DESC LIMIT 10`,
        )
        .all<{ page: string | null; n: number }>(...args),
      [],
    ),
    safe(
      db
        .prepare(
          `SELECT COUNT(*) AS views, SUM(depth >= 25) AS q1, SUM(depth >= 50) AS q2, SUM(depth >= 75) AS q3, SUM(depth >= 95) AS q4
             FROM heat_views WHERE at >= ? AND at < ? AND device = ? AND page = ?`,
        )
        .get<{ views: number; q1: number | null; q2: number | null; q3: number | null; q4: number | null }>(...args),
      undefined,
    ),
  ]);
  const views = Number(reach?.views ?? 0);
  const pct = (n: number | null | undefined) => (views ? Math.round((Number(n ?? 0) / views) * 100) : 0);
  const same = pageLabel(page);
  return {
    page,
    label: same,
    views,
    samplePath: sample?.path ?? "/",
    taps: taps.map((t) => ({ x: Number(t.x), y: Number(t.y), h: Number(t.h), fixed: Number(t.fixed) })),
    tapCount: Number(tapTotals?.n ?? 0),
    deadTaps: Number(tapTotals?.dead ?? 0),
    topLabels: labels.map((r) => ({ label: r.label, n: Number(r.n) })),
    next: next.map((r) => ({ label: r.page === null ? LEFT : r.page === page ? `${same} again` : pageLabel(r.page), n: Number(r.n) })),
    previous: prev.map((r) => ({ label: r.page === null ? FIRST : r.page === page ? `${same} again` : pageLabel(r.page), n: Number(r.n) })),
    reach: [
      { mark: 25, pct: pct(reach?.q1) },
      { mark: 50, pct: pct(reach?.q2) },
      { mark: 75, pct: pct(reach?.q3) },
      { mark: 100, pct: pct(reach?.q4) },
    ],
  };
}
