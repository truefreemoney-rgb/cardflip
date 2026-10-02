import "server-only";
import { db } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/server/settings";
import { addCompletedLine, eastern, SLOTS } from "@/lib/server/socialPublish";
import { addScheduleEntry, loadSchedule } from "@/lib/server/socialSchedule";
import { LEAD_DAYS, MAX_AGE_DAYS, SCORED_KINDS, step, type LoopState, type OptimizeReport, type ScoredKind, type ScoredPost, type Sitting, type Trial } from "@/lib/socialOptimize";
import { standingFor } from "@/lib/socialPlan";
import { runSocialTags } from "@/lib/server/socialTags";
import type { TagPost } from "@/lib/socialTags";

/**
 * The daily social optimization loop, the job (Chris 10-02: "should be
 * daily"; the rules are in lib/socialOptimize.ts). Runs once per Eastern
 * day, on the first social-inbox cron ping of the day (8am ET), right after
 * that ping has stored and tagged the posts. It scores each kind from
 * social_posts, keeps the day's report in settings for /admin/social, and
 * does at most one thing: start a one-week trial of the benched kind in the
 * 7am or 7pm slot, or end a trial (keep it, or put the old kind back). Each
 * of those leaves one line on the board.
 *
 * It changes the schedule only by adding an entry to the standing schedule
 * (lib/server/socialSchedule.ts), always LEAD_DAYS out. The Off switch on
 * /admin/social (OPT_OFF_KEY) freezes it: scores and report only.
 */
export const OPT_LAST_KEY = "social_optimize:last";
export const OPT_REPORT_KEY = "social_optimize:report";
/** "1" = switched off on /admin/social. */
export const OPT_OFF_KEY = "social_optimize:off";
/** The running trial (JSON Trial), "" when none. */
export const OPT_TRIAL_KEY = "social_optimize:trial";
/** Eastern day of the last trial start or verdict. */
export const OPT_CHANGED_KEY = "social_optimize:changed";
/** Eastern day the loop first ran. */
export const OPT_SINCE_KEY = "social_optimize:since";
/** JSON { "slot:kind": day } of trials that failed. */
export const OPT_FAILED_KEY = "social_optimize:failed";

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return (JSON.parse(raw) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function dayAfter(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** The standing schedule on a day (one-off day plans aside): SLOTS, unless the loop's schedule says otherwise. */
function sittingOn(day: string): Sitting {
  const s = standingFor(day);
  return { morning: (s?.morning ?? SLOTS.morning.kind) as ScoredKind, midday: SLOTS.midday.kind as ScoredKind, evening: (s?.evening ?? SLOTS.evening.kind) as ScoredKind };
}

/** Run the day's loop if it has not run yet. Returns the report, or null when today's is already done. */
export async function runSocialOptimize(now = Date.now()): Promise<OptimizeReport | null> {
  const { day } = eastern(now);
  if ((await getSetting(OPT_LAST_KEY)) === day) return null;
  // first_seen_at is within hours of the post and is a plain integer (at is text in each platform's own shape); a week of slack past the window.
  const since = now - (MAX_AGE_DAYS + 7) * 86_400_000;
  const rows = (await db
    .prepare(`SELECT site, kind, slot, at, text, likes, comments, shares, views FROM social_posts WHERE kind IN (${SCORED_KINDS.map(() => "?").join(", ")}) AND first_seen_at >= ?`)
    .all(...SCORED_KINDS, since)) as Record<string, unknown>[];
  const n = (v: unknown): number | null => (v == null ? null : Number(v));
  const posts: ScoredPost[] = rows.map((r) => ({ site: String(r.site), kind: String(r.kind), slot: String(r.slot ?? ""), at: String(r.at ?? ""), views: n(r.views), likes: n(r.likes), comments: n(r.comments), shares: n(r.shares) }));

  await loadSchedule(now);
  const sinceDay = (await getSetting(OPT_SINCE_KEY)) || day;
  const failed = parseJson<Record<string, string>>(await getSetting(OPT_FAILED_KEY), {});
  const state: LoopState = {
    off: (await getSetting(OPT_OFF_KEY)) === "1",
    trial: parseJson<Trial | null>(await getSetting(OPT_TRIAL_KEY), null),
    lastChangeDay: (await getSetting(OPT_CHANGED_KEY)) || null,
    sinceDay,
    failed,
  };
  // A change starts LEAD_DAYS out, so that day's schedule is the one to judge against.
  const sitting = sittingOn(dayAfter(day, LEAD_DAYS));
  const { report, action, line } = step({ posts, now, sitting, state });

  if (action.type === "start") {
    await addScheduleEntry({ from: action.trial.start, morning: sitting.morning, evening: sitting.evening, [action.trial.slot]: action.trial.to }, now);
    await setSetting(OPT_TRIAL_KEY, JSON.stringify(action.trial));
    await setSetting(OPT_CHANGED_KEY, day);
  } else if (action.type === "keep") {
    await setSetting(OPT_TRIAL_KEY, "");
    await setSetting(OPT_CHANGED_KEY, day);
  } else if (action.type === "back") {
    await addScheduleEntry({ from: action.from, morning: sitting.morning, evening: sitting.evening, [action.trial.slot]: action.trial.from }, now);
    await setSetting(OPT_FAILED_KEY, JSON.stringify({ ...failed, [`${action.trial.slot}:${action.trial.to}`]: day }));
    await setSetting(OPT_TRIAL_KEY, "");
    await setSetting(OPT_CHANGED_KEY, day);
  }
  if (line) await addCompletedLine(line, now);
  // Hashtags: the same once-a-day run, the same Off switch, its own trial (lib/socialTags.ts).
  const tagPosts: TagPost[] = rows.map((r) => ({ site: String(r.site), at: String(r.at ?? ""), text: String(r.text ?? ""), views: n(r.views), likes: n(r.likes), comments: n(r.comments), shares: n(r.shares) }));
  const tagLine = await runSocialTags(tagPosts, now, day, state.off);
  if (tagLine) await addCompletedLine(tagLine, now);
  await setSetting(OPT_SINCE_KEY, sinceDay);
  await setSetting(OPT_REPORT_KEY, JSON.stringify(report));
  await setSetting(OPT_LAST_KEY, day);
  return report;
}

/** For /admin/social: the switch and what the loop last said. */
export async function optimizerStatus(): Promise<{ on: boolean; day: string | null; why: string | null }> {
  const report = parseJson<OptimizeReport | null>(await getSetting(OPT_REPORT_KEY), null);
  return { on: (await getSetting(OPT_OFF_KEY)) !== "1", day: report?.day ?? null, why: report?.why ?? null };
}
