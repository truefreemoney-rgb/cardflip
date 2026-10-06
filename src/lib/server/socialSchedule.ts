import "server-only";
import { getSetting, setSetting } from "@/lib/server/settings";
import { loadTagPlan } from "@/lib/server/socialTags";
import { ANGLE_GAMES, ANGLE_KINDS, isAngleKind, setStanding, type AngleGame, type StandingEntry } from "@/lib/socialPlan";

/**
 * The standing schedule the daily optimization loop writes (10-02): which
 * kind 7am and 7pm post from a given Eastern day on. Stored as one settings
 * row, so a change is data, not a deploy; loaded into lib/socialPlan.ts so
 * the sync readers (slotKind, planTag, candidateKinds) all see it.
 *
 * Every async way into those readers calls ensureSchedule() first: the
 * publisher, the TikTok package, the render script, the admin page. An
 * entry is written the evening before it starts, as the first step of the
 * night render (10-03), so a process holding a copy a few minutes old is
 * never wrong about today.
 */
export const SCHEDULE_KEY = "social_schedule";
/** Entries kept: a month of daily picks (phase 3 writes one a day; the optimizer's no-repeat rule reads the last two). */
const KEEP = 30;
const TTL_MS = 5 * 60_000;
/** The kinds a slot may post: the four originals (movers too since 10-06: 1pm joined the rotation) and the five angles. */
const OPEN_KINDS = ["set", "movers", "games", "dips", ...ANGLE_KINDS];
const GAMES = ["pokemon", "mtg", "lorcana", "onepiece", "yugioh", "mixed"];

export function parseSchedule(raw: string | null | undefined): StandingEntry[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    const kind = (v: unknown) => (typeof v === "string" && OPEN_KINDS.includes(v) ? (v as StandingEntry["morning"]) : undefined);
    // A game rides only with an angle kind, and only one the kind runs for.
    const game = (k: StandingEntry["morning"], v: unknown) => (k && isAngleKind(k) && typeof v === "string" && GAMES.includes(v) && (ANGLE_GAMES[k] as string[]).includes(v) ? (v as AngleGame) : undefined);
    return list
      .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object" && /^\d{4}-\d{2}-\d{2}$/.test(String((e as Record<string, unknown>).from)))
      .map((e) => {
        const morning = kind(e.morning);
        const evening = kind(e.evening);
        const morningGame = game(morning, e.morningGame);
        const eveningGame = game(evening, e.eveningGame);
        const midday = kind(e.midday);
        const middayGame = game(midday, e.middayGame);
        // Only "picture" is worth storing: absent means video.
        const format = (v: unknown) => (v === "picture" ? ("picture" as const) : undefined);
        const morningFormat = format(e.morningFormat);
        const eveningFormat = format(e.eveningFormat);
        return {
          from: String(e.from),
          ...(morning ? { morning } : {}),
          ...(evening ? { evening } : {}),
          ...(morningGame ? { morningGame } : {}),
          ...(eveningGame ? { eveningGame } : {}),
          ...(midday ? { midday } : {}),
          ...(middayGame ? { middayGame } : {}),
          ...(morningFormat ? { morningFormat } : {}),
          ...(eveningFormat ? { eveningFormat } : {}),
        };
      });
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
