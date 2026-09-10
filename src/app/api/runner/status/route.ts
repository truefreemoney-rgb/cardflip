import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { errorCount24h, errorGroups24h } from "@/lib/server/errorLog";
import { scanSpendSummary } from "@/lib/server/scanUsage";
import { getAdminOverview } from "@/lib/server/adminStats";
import { BOARD_REPO, ghHeaders } from "@/lib/server/boardRuns";

export const dynamic = "force-dynamic";

/**
 * What the board runner may know about production (runner upgrade 4, Chris
 * yes 09-10): the last day's errors grouped, the last production smoke run,
 * scan spend, the deploy sha and the daily job. Read-only by construction —
 * this route touches nothing — and guarded by its own secret (RUNNER_TOKEN)
 * that only the routine holds, so it can't reach Vercel, Stripe, eBay or the
 * database no matter what it is asked to do.
 *
 *   curl -H "Authorization: Bearer $RUNNER_TOKEN" https://cardflip.io/api/runner/status
 */
export async function GET(req: Request) {
  const expected = process.env.RUNNER_TOKEN;
  if (!expected) return NextResponse.json({ error: "RUNNER_TOKEN is not set" }, { status: 503 });
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }

  const now = Date.now();
  const [overview, errors24h, groups, spend, smoke] = await Promise.all([
    getAdminOverview(now),
    errorCount24h(),
    errorGroups24h(10),
    scanSpendSummary(),
    lastProdSmoke(),
  ]);

  return NextResponse.json({
    at: new Date(now).toISOString(),
    deploy: overview.system.deploy,
    dailyJob: overview.data.daily,
    errors: { last24h: errors24h, groups },
    scans: spend,
    prodSmoke: smoke,
  });
}

/** The last run of the prod-smoke workflow, from GitHub (same token the board uses). */
async function lastProdSmoke(): Promise<{ conclusion: string | null; at: string | null; url: string | null } | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${BOARD_REPO}/actions/workflows/prod-smoke.yml/runs?per_page=1`, {
      headers: ghHeaders(token),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { workflow_runs?: { conclusion: string | null; updated_at: string; html_url: string }[] };
    const run = data.workflow_runs?.[0];
    return run ? { conclusion: run.conclusion, at: run.updated_at, url: run.html_url } : null;
  } catch {
    return null;
  }
}
