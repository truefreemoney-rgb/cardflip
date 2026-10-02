import "server-only";
import { getSetting, setSetting } from "@/lib/server/settings";
import { parseTagPlan, setTagPlan, tagStep, type TagPlan, type TagPost } from "@/lib/socialTags";

/**
 * Hashtags in the daily optimization loop, the settings and the job (Chris
 * 10-02; the rules are in lib/socialTags.ts). The tag plan is one settings
 * row, loaded into lib/socialTags.ts together with the standing schedule
 * (loadSchedule in lib/server/socialSchedule.ts), so every way into the
 * publisher and the TikTok package already reads it. A trial or a standing
 * swap is always written TAG_LEAD_DAYS before it starts.
 */
export const TAGS_KEY = "social_tags";
/** Eastern day of the last tag trial start or verdict. */
export const TAGS_CHANGED_KEY = "social_tags:changed";
/** JSON { "out:in": day } of challengers that lost. */
export const TAGS_FAILED_KEY = "social_tags:failed";
/** What the loop last said about hashtags (one sentence). */
export const TAGS_WHY_KEY = "social_tags:why";
/** Standing swaps kept: more than TAG_CANDIDATES can ever win. */
const KEEP = 12;

/** Read the tag plan from settings into this process. */
export async function loadTagPlan(): Promise<TagPlan> {
  const plan = parseTagPlan(await getSetting(TAGS_KEY));
  setTagPlan(plan);
  return plan;
}

async function saveTagPlan(plan: TagPlan): Promise<void> {
  await setSetting(TAGS_KEY, JSON.stringify(plan));
  setTagPlan(plan);
}

/** The day's hashtag move (runSocialOptimize calls it once per Eastern day). Returns a board line on a start or a verdict. */
export async function runSocialTags(posts: TagPost[], now: number, day: string, off: boolean): Promise<string | null> {
  const plan = await loadTagPlan();
  let failed: Record<string, string> = {};
  try {
    failed = (JSON.parse((await getSetting(TAGS_FAILED_KEY)) || "{}") as Record<string, string>) ?? {};
  } catch {
    failed = {};
  }
  const { action, why, line } = tagStep({ posts, now, state: { off, plan, lastChangeDay: (await getSetting(TAGS_CHANGED_KEY)) || null, failed } });
  if (action.type === "start") {
    await saveTagPlan({ swaps: plan.swaps, trial: action.trial });
  } else if (action.type === "keep") {
    await saveTagPlan({ swaps: [...plan.swaps, action.swap].slice(-KEEP), trial: null });
  } else if (action.type === "back") {
    await setSetting(TAGS_FAILED_KEY, JSON.stringify({ ...failed, [`${action.trial.out}:${action.trial.in}`]: day }));
    await saveTagPlan({ swaps: plan.swaps, trial: null });
  }
  if (action.type !== "none") await setSetting(TAGS_CHANGED_KEY, day);
  await setSetting(TAGS_WHY_KEY, why);
  return line;
}
