import "server-only";
import { getSetting, setSetting } from "@/lib/server/settings";
import { loadTagPlan } from "@/lib/server/socialTags";
import { setStanding, type StandingEntry } from "@/lib/socialPlan";

/**
 * The standing schedule the daily optimization loop writes (10-02): which
 * kind 7am and 7pm post from a given Eastern day on. Stored as one settings
 * row, so a change is data, not a deploy; loaded into lib/socialPlan.ts so
 * the sync readers (slotKind, planTag, candidateKinds) all see it.
 *
 * Every async way into those readers calls ensureSchedule() first: the
 * publisher, the TikTok package, the render script, the admin page. An
 * entry is always written two days before it starts (tomorrow's TikTok
 * videos render tonight), so a process holding a copy a few minutes old is
 * never wrong about today.
 */
export const SCHEDULE_KEY = "social_schedule";
/** Entries kept: the one in force, a few before it, and any still to start. */
const KEEP = 8;
const TTL_MS = 5 * 60_000;
const OPEN_KINDS = ["set", "games", "dips"];

export function parseSchedule(raw: string | null | undefined): StandingEntry[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    const kind = (v: unknown) => (typeof v === "string" && OPEN_KINDS.includes(v) ? (v as StandingEntry["morning"]) : undefined);
    return list
      .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object" && /^\d{4}-\d{2}-\d{2}$/.test(String((e as Record<string, unknown>).from)))
      .map((e) => ({ from: String(e.from), ...(kind(e.morning) ? { morning: kind(e.morning) } : {}), ...(kind(e.evening) ? { evening: kind(e.evening) } : {}) }));
  } catch {
    return [];
  }
}

let loadedAt = 0;

/** Read the schedule from settings into this process. */
export async function loadSchedule(now = Date.now()): Promise<StandingEntry[]> {
  const entries = parseSchedule(await getSetting(SCHEDULE_KEY));
  setStanding(entries);
  // The hashtag plan rides along: whoever asks what a slot posts also needs the tags it posts with.
  await loadTagPlan();
  loadedAt = now;
  return entries;
}

/** Load the schedule unless this process read it in the last few minutes. Call before slotKind / planTag / candidateKinds. */
export async function ensureSchedule(now = Date.now()): Promise<void> {
  if (now - loadedAt < TTL_MS && now >= loadedAt) return;
  await loadSchedule(now);
}

/** Add one entry (replacing any with the same start day) and keep the newest KEEP. */
export async function addScheduleEntry(entry: StandingEntry, now = Date.now()): Promise<StandingEntry[]> {
  const entries = [...(await loadSchedule(now)).filter((e) => e.from !== entry.from), entry].sort((a, b) => (a.from < b.from ? -1 : 1)).slice(-KEEP);
  await setSetting(SCHEDULE_KEY, JSON.stringify(entries));
  setStanding(entries);
  return entries;
}
