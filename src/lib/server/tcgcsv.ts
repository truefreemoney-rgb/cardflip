import "server-only";
import { getSetting, setSetting } from "@/lib/server/settings";

/**
 * tcgcsv.com house rules (https://tcgcsv.com/docs#usage-guidelines), after
 * the 10-08 block: the operator blocked our old "CardFlip/1.0 (+url)" name
 * by hand (403 on any "CardFlip/" agent; Chris: comply and ask them to lift
 * it). Every tcgcsv fetch goes through these:
 *   - User-Agent exactly in their "App/X.Y.Z" form;
 *   - at least 100 ms between requests (they throttle the IP for 10 min);
 *   - a full pull only when last-updated.txt moved since our last pull.
 */
export const TCGCSV_UA = "CardFlip/1.0.0";
export const TCGCSV_HEADERS = { "User-Agent": TCGCSV_UA, Accept: "application/json" };
export const TCGCSV_PAUSE_MS = 120;

const STAMP_PREFIX = "tcgcsv_pulled:";

/**
 * Every tcgcsv request goes through here: ONE request at a time across the
 * whole process with TCGCSV_PAUSE_MS between starts (parallel workers no
 * longer multiply the rate), and no retry storms: a 429 waits 10 s and tries
 * once more, a 5xx waits 2 s and tries once more, anything else is returned
 * as is. Their 10k-a-day soft limit was blown by 6 workers at 60 ms plus
 * four retries per failure (operator, 10-08).
 */
let gate: Promise<void> = Promise.resolve();
let lastStart = 0;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function tcgcsvFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = { ...TCGCSV_HEADERS, ...(init.headers as Record<string, string> | undefined) };
  const once = async (): Promise<Response> => {
    const turn = gate.then(async () => {
      const gap = TCGCSV_PAUSE_MS - (Date.now() - lastStart);
      if (gap > 0) await wait(gap);
      lastStart = Date.now();
    });
    gate = turn.catch(() => {});
    await turn;
    return fetch(url, { signal: AbortSignal.timeout(60_000), ...init, headers });
  };
  let res = await once();
  if (res.status === 429) {
    await wait(10_000);
    res = await once();
  } else if (res.status >= 500) {
    await wait(2_000);
    res = await once();
  }
  return res;
}

export interface TcgcsvFresh {
  /** Their build stamp, or null when last-updated.txt could not be read (then we pull, as before). */
  stamp: string | null;
  /** False = our last pull for `key` already saw this build: nothing to fetch today. */
  changed: boolean;
  /** Call after a successful pull so the next day's check can skip an unchanged build. */
  done: () => Promise<void>;
}

/** Has tcgcsv published a new build since our last successful pull for `key` (pokemon, onepiece, yugioh, ...)? */
export async function tcgcsvFresh(key: string, deps: { fetch?: typeof fetch } = {}): Promise<TcgcsvFresh> {
  let stamp: string | null = null;
  try {
    const res = await (deps.fetch ?? fetch)("https://tcgcsv.com/last-updated.txt", { headers: { "User-Agent": TCGCSV_UA }, signal: AbortSignal.timeout(15_000) });
    if (res.ok) stamp = (await res.text()).trim().slice(0, 64) || null;
    else console.warn(`tcgcsv last-updated.txt → HTTP ${res.status}`);
  } catch (err) {
    console.warn("tcgcsv last-updated.txt failed:", err instanceof Error ? err.message : err);
  }
  const seen = stamp ? await getSetting(`${STAMP_PREFIX}${key}`) : null;
  const changed = !stamp || seen !== stamp;
  return {
    stamp,
    changed,
    done: async () => {
      if (stamp) await setSetting(`${STAMP_PREFIX}${key}`, stamp);
    },
  };
}
