import "server-only";
import { db } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/server/settings";
import { addCompletedLine, eastern, SLOTS } from "@/lib/server/socialPublish";
import { KIND_NAME, MAX_AGE_DAYS, optimize, SCORED_KINDS, SLOT_NAME, type OptimizeReport, type ScoredKind, type ScoredPost } from "@/lib/socialOptimize";

/**
 * The daily social optimization loop, the job half (Chris 10-02: "should be
 * daily"; the rules are in lib/socialOptimize.ts). Runs once per Eastern
 * day, on the first social-inbox cron ping of the day (8am ET), right after
 * that ping has stored and tagged the posts. It scores each kind from
 * social_posts, keeps the day's report in settings for the admin pages, and
 * leaves one line on the board when it finds a change worth making (once
 * per finding, not once per day).
 *
 * REPORTING ONLY for now: nothing reads OPT_REPORT_KEY to change what
 * posts. The switch that lets a finding move the 7am / 7pm kind is its own
 * step.
 */
export const OPT_LAST_KEY = "social_optimize:last";
export const OPT_REPORT_KEY = "social_optimize:report";
export const OPT_NOTED_KEY = "social_optimize:noted";
/** Eastern day of the last change the loop made (written by the switch, when it ships). */
export const OPT_CHANGED_KEY = "social_optimize:changed";

/** Run the day's scoring if it has not run yet. Returns the report, or null when today's is already done. */
export async function runSocialOptimize(now = Date.now()): Promise<OptimizeReport | null> {
  const { day } = eastern(now);
  if ((await getSetting(OPT_LAST_KEY)) === day) return null;
  // first_seen_at is within hours of the post and is a plain integer (at is text in each platform's own shape); a week of slack past the window.
  const since = now - (MAX_AGE_DAYS + 7) * 86_400_000;
  const rows = (await db
    .prepare(`SELECT site, kind, at, likes, comments, shares, views FROM social_posts WHERE kind IN (${SCORED_KINDS.map(() => "?").join(", ")}) AND first_seen_at >= ?`)
    .all(...SCORED_KINDS, since)) as Record<string, unknown>[];
  const n = (v: unknown): number | null => (v == null ? null : Number(v));
  const posts: ScoredPost[] = rows.map((r) => ({ site: String(r.site), kind: String(r.kind), at: String(r.at ?? ""), views: n(r.views), likes: n(r.likes), comments: n(r.comments), shares: n(r.shares) }));
  const report = optimize({
    posts,
    now,
    sitting: { morning: SLOTS.morning.kind as ScoredKind, midday: SLOTS.midday.kind as ScoredKind, evening: SLOTS.evening.kind as ScoredKind },
    lastChangeDay: await getSetting(OPT_CHANGED_KEY),
  });
  await setSetting(OPT_REPORT_KEY, JSON.stringify(report));
  await setSetting(OPT_LAST_KEY, day);
  if (report.change) {
    const finding = `${report.change.slot}:${report.change.from}>${report.change.to}`;
    if ((await getSetting(OPT_NOTED_KEY)) !== finding) {
      await addCompletedLine(
        `Social optimizer ${day} — worth a trial: ${KIND_NAME[report.change.to]} at ${SLOT_NAME[report.change.slot]} in place of ${KIND_NAME[report.change.from]}. ${report.why} Reporting only: nothing changed.`,
        now,
      );
      await setSetting(OPT_NOTED_KEY, finding);
    }
  }
  return report;
}
