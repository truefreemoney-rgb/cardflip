import "server-only";
import { getSetting, setSetting } from "@/lib/server/settings";
import { opsAlert } from "@/lib/server/opsAlert";

/**
 * When the publisher itself throws (10-02 9:51pm ET: /api/social/publish
 * answered 500 with no body, the only trace was a GitHub "Run failed" mail
 * and nobody could say why), the route records the error here and mails
 * Chris the message. /admin/social shows the last crash for two days.
 * Per-site failures are a different thing (alertFailures in socialPublish.ts);
 * this is the whole run falling over before any site was tried.
 */
export const SOCIAL_CRASH_KEY = "social_publish_crash";
export const SOCIAL_CRASH_SHOW_MS = 48 * 60 * 60 * 1000;

export interface PublishCrash {
  at: number;
  slot: string | null;
  message: string;
}

export function crashMessage(err: unknown): string {
  const m = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return m.replace(/\s+/g, " ").trim().slice(0, 500) || "unknown error";
}

/** Record the crash and mail it (one mail an hour, opsAlert's gap). Never throws: the route's 500 must still go out. */
export async function recordPublishCrash(
  err: unknown,
  ctx: { slot?: string | null; now?: number },
  deps: {
    get?: (k: string) => Promise<string | null>;
    set?: (k: string, v: string) => Promise<void>;
    send?: (a: { workflow: string; message?: string }) => Promise<void>;
  } = {},
): Promise<PublishCrash> {
  const now = ctx.now ?? Date.now();
  const crash: PublishCrash = { at: now, slot: ctx.slot ?? null, message: crashMessage(err) };
  const set = deps.set ?? setSetting;
  try {
    await set(SOCIAL_CRASH_KEY, JSON.stringify(crash));
  } catch {
    /* the DB may be the thing that is down */
  }
  try {
    await opsAlert({ workflow: "social-publish", message: `The publisher crashed${crash.slot ? ` on the ${crash.slot} slot` : ""}: ${crash.message}` }, now, deps);
  } catch {
    /* mail down too: the 500 and the GitHub run mail still say something broke */
  }
  return crash;
}

/** The last crash, if it is recent enough to show on /admin/social. */
export async function recentPublishCrash(now = Date.now(), get: (k: string) => Promise<string | null> = getSetting): Promise<PublishCrash | null> {
  try {
    const raw = await get(SOCIAL_CRASH_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as PublishCrash;
    if (typeof c.at !== "number" || typeof c.message !== "string") return null;
    return now - c.at <= SOCIAL_CRASH_SHOW_MS ? c : null;
  } catch {
    return null;
  }
}
