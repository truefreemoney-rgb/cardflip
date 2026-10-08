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
