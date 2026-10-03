import "server-only";
import { db } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/server/settings";
import { addCompletedLine, eastern, slotKind } from "@/lib/server/socialPublish";
import { addScheduleEntry, loadSchedule } from "@/lib/server/socialSchedule";
import { LEAD_DAYS, MAX_AGE_DAYS, NO_REPEAT_DAYS, SCORED_KINDS, step, type DayPicks, type FormatScore, type KindScore, type OptimizeReport, type ScoredKind, type ScoredPost } from "@/lib/socialOptimize";
import { runSocialTags, TAGS_WHY_KEY } from "@/lib/server/socialTags";
import type { TagPost } from "@/lib/socialTags";

/**
 * The daily social optimization loop, the job (Chris 10-02: "should be
 * daily"; 10-03: the five angles and the game rotate, "the optimizer makes
 * the choices"; the rules are in lib/socialOptimize.ts). Runs once per
 * Eastern day, on the first social-inbox cron ping of the day (8am ET),
 * right after that ping has stored and tagged the posts. It scores each
 * kind from social_posts, keeps the day's report in settings for
 * /admin/social, and writes TOMORROW's picks for 7am and 7pm (a seeded
 * weighted draw over the eight pool kinds, with each angle's game) as one
 * standing schedule entry (lib/server/socialSchedule.ts): tomorrow's TikTok
 * videos render tonight from it. The Off switch on /admin/social
 * (OPT_OFF_KEY) writes nothing, so the entry in force stays.
 */
export const OPT_LAST_KEY = "social_optimize:last";
export const OPT_REPORT_KEY = "social_optimize:report";
/** "1" = switched off on /admin/social. */
export const OPT_OFF_KEY = "social_optimize:off";

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

/** What the two open slots post on a day, as the schedule stands (standing entries, one-off day plans, SLOTS). */
function kindsOn(day: string): { morning: ScoredKind; evening: ScoredKind } {
  return { morning: slotKind("morning", day) as ScoredKind, evening: slotKind("evening", day) as ScoredKind };
}

/** Run the day's loop if it has not run yet. Returns the report, or null when today's is already done. */
export async function runSocialOptimize(now = Date.now()): Promise<OptimizeReport | null> {
  const { day } = eastern(now);
  if ((await getSetting(OPT_LAST_KEY)) === day) return null;
  // first_seen_at is within hours of the post and is a plain integer (at is text in each platform's own shape); a week of slack past the window.
  const since = now - (MAX_AGE_DAYS + 7) * 86_400_000;
  const rows = (await db
    .prepare(`SELECT site, kind, slot, at, text, likes, comments, shares, views, game, format FROM social_posts WHERE kind IN (${SCORED_KINDS.map(() => "?").join(", ")}) AND first_seen_at >= ?`)
    .all(...SCORED_KINDS, since)) as Record<string, unknown>[];
  const n = (v: unknown): number | null => (v == null ? null : Number(v));
  const posts: ScoredPost[] = rows.map((r) => ({
    site: String(r.site),
    kind: String(r.kind),
    slot: String(r.slot ?? ""),
    at: String(r.at ?? ""),
    views: n(r.views),
    likes: n(r.likes),
    comments: n(r.comments),
    shares: n(r.shares),
    game: r.game ? String(r.game) : null,
    format: r.format ? String(r.format) : null,
  }));

  await loadSchedule(now);
  const target = dayAfter(day, LEAD_DAYS);
  const yesterday = kindsOn(dayAfter(target, -1));
  const recent = Array.from({ length: NO_REPEAT_DAYS }, (_, i) => kindsOn(dayAfter(target, -1 - i))).flatMap((k) => [k.morning, k.evening]);
  const off = (await getSetting(OPT_OFF_KEY)) === "1";
  const { report, entry } = step({ posts, now, day: target, off, yesterday, recent });
  if (entry) await addScheduleEntry(entry, now);

  // Hashtags: the same once-a-day run, the same Off switch, its own trial (lib/socialTags.ts).
  const tagPosts: TagPost[] = rows.map((r) => ({ site: String(r.site), at: String(r.at ?? ""), text: String(r.text ?? ""), views: n(r.views), likes: n(r.likes), comments: n(r.comments), shares: n(r.shares) }));
  const tagLine = await runSocialTags(tagPosts, now, day, off);
  if (tagLine) await addCompletedLine(tagLine, now);
  await setSetting(OPT_REPORT_KEY, JSON.stringify(report));
  await setSetting(OPT_LAST_KEY, day);
  return report;
}

export interface OptimizerStatus {
  on: boolean;
  day: string | null;
  why: string | null;
  /** The day the picks are for, and the picks. */
  forDay: string | null;
  picks: DayPicks | null;
  scores: KindScore[];
  formats: FormatScore[];
  weights: Record<string, number>;
}

/** For /admin/social: the switch, the day's picks, each kind's score, and what the loop last said (kinds and hashtags, the same 8am job). */
export async function optimizerStatus(): Promise<OptimizerStatus> {
  const report = parseJson<Partial<OptimizeReport> | null>(await getSetting(OPT_REPORT_KEY), null);
  const tagsWhy = report ? await getSetting(TAGS_WHY_KEY) : null;
  const why = [report?.why, tagsWhy].filter(Boolean).join(" ");
  return {
    on: (await getSetting(OPT_OFF_KEY)) !== "1",
    day: report?.day ?? null,
    why: why || null,
    forDay: report?.forDay ?? null,
    picks: report?.picks ?? null,
    scores: Array.isArray(report?.scores) ? report.scores : [],
    formats: Array.isArray(report?.formats) ? report.formats : [],
    weights: report?.weights ?? {},
  };
}
