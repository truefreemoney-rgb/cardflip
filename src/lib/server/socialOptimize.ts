import "server-only";
import { db } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/server/settings";
import { addCompletedLine, eastern, slotKind } from "@/lib/server/socialPublish";
import { addScheduleEntry, loadSchedule } from "@/lib/server/socialSchedule";
import { GAME_NAME, KIND_NAME, LEAD_DAYS, MAX_AGE_DAYS, NO_REPEAT_DAYS, SCORED_KINDS, USAGE_DAYS, step, type DayPicks, type FormatScore, type KindScore, type OptimizeReport, type ScoredKind, type ScoredPost } from "@/lib/socialOptimize";
import { runSocialTags, TAGS_WHY_KEY } from "@/lib/server/socialTags";
import type { TagPost } from "@/lib/socialTags";

/**
 * The daily social optimization loop, the job (Chris 10-02: "should be
 * daily"; 10-03: the five angles and the game rotate, "the optimizer makes
 * the choices"; the rules are in lib/socialOptimize.ts). Runs once per
 * target day, in the evening as the first step of the night render (Chris
 * 10-03 night: "run the optimizer, look at the data and create the next
 * day's post based on the data"); the videos draw from its picks in the
 * same run. It scores each
 * kind from social_posts, keeps the day's report in settings for
 * /admin/social, and writes TOMORROW's picks for 7am, 1pm and 7pm (a
 * deterministic fair rotation over all nine kinds, with each angle's game) as one
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

/** What the three slots post on a day, as the schedule stands (standing entries, one-off day plans, SLOTS). */
function kindsOn(day: string): { morning: ScoredKind; midday: ScoredKind; evening: ScoredKind } {
  return { morning: slotKind("morning", day) as ScoredKind, midday: slotKind("midday", day) as ScoredKind, evening: slotKind("evening", day) as ScoredKind };
}

/**
 * Run the loop for a target day if it has not run for that day yet. Returns
 * the report, or null when that day's picks are already written. The night
 * render calls it first (scripts/social-video.mjs --package, and the 9:15pm
 * safety net before it looks at the package), with the day it is about to
 * render: picks, then videos, in one pass. Without `target` it is tomorrow.
 */
export async function runSocialOptimize(now = Date.now(), opts: { target?: string } = {}): Promise<OptimizeReport | null> {
  const { day } = eastern(now);
  const target = opts.target ?? dayAfter(day, LEAD_DAYS);
  if ((await getSetting(OPT_LAST_KEY)) === target) return null;
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
  const yesterday = kindsOn(dayAfter(target, -1));
  const recent = Array.from({ length: NO_REPEAT_DAYS }, (_, i) => kindsOn(dayAfter(target, -1 - i))).flatMap((k) => [k.morning, k.midday, k.evening]);
  const off = (await getSetting(OPT_OFF_KEY)) === "1";
  // The fair rotation (10-06): how many slots each kind actually posted in the last USAGE_DAYS days (one count per day+slot, whatever the site count).
  const usedRows = (await db.prepare("SELECT DISTINCT day, slot, kind FROM social_post_log WHERE day >= ?").all(dayAfter(target, -USAGE_DAYS))) as Record<string, unknown>[];
  const used: Partial<Record<ScoredKind, number>> = {};
  for (const r of usedRows) if ((SCORED_KINDS as string[]).includes(String(r.kind))) used[r.kind as ScoredKind] = (used[r.kind as ScoredKind] ?? 0) + 1;
  const { report, entry } = step({ posts, now, day: target, off, yesterday, recent, used });
  if (entry) {
    await addScheduleEntry(entry, now);
    // Every change the optimizer makes is on the board's Completed list (Chris 10-03: "I need to be made aware of changes").
    const pick = (p: DayPicks["morning"]) => `${KIND_NAME[p.kind] ?? p.kind}${p.game ? ` (${GAME_NAME[p.game as keyof typeof GAME_NAME] ?? p.game})` : ""}${p.format === "picture" ? ", picture" : ""}`;
    // The scores ride along (10-06, Chris: "make the optimizer run at its best"): each style's score and post count,
    // "new" while it is still being tried, so the pick can be checked against the numbers on the board itself.
    const scoreText = report.scores
      .map((s) => `${KIND_NAME[s.kind] ?? s.kind} ${s.score != null ? s.score : "new"} (${s.posts})`)
      .join(", ");
    if (report.picks) await addCompletedLine(`Social optimizer ${day} — ${target}: 7am ${pick(report.picks.morning)}, 1pm ${pick(report.picks.midday)}, 7pm ${pick(report.picks.evening)}. Scores (1.0 = average, posts): ${scoreText}`, now);
  }

  // Hashtags: the same once-a-day run, the same Off switch, its own trial (lib/socialTags.ts).
  const tagPosts: TagPost[] = rows.map((r) => ({ site: String(r.site), at: String(r.at ?? ""), text: String(r.text ?? ""), views: n(r.views), likes: n(r.likes), comments: n(r.comments), shares: n(r.shares) }));
  const tagLine = await runSocialTags(tagPosts, now, day, off);
  if (tagLine) await addCompletedLine(tagLine, now);
  await setSetting(OPT_REPORT_KEY, JSON.stringify(report));
  await setSetting(OPT_LAST_KEY, target);
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
