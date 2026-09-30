import type { PostKind } from "@/lib/server/social";
import type { Slot } from "@/lib/server/socialPublish";
import { parseVideoSpec, type VideoSpec } from "@/lib/socialVideo";

/**
 * TikTok by hand (Chris 09-30). TikTok refused the developer app for
 * production ("Applications intended for personal use or internal company use
 * are not eligible"), so API posts would be private forever, and he declined
 * a paid posting service. The autopilot no longer touches TikTok. Instead,
 * every evening after the 7:05pm post, ONE render run (scripts/social-video.mjs
 * --package, GitHub Actions) builds tomorrow's three 9:16 videos, one per
 * slot, each registered with its caption, and /admin/social hands them over:
 *
 *   7:05am  the morning picture post as a video (normally the set spotlight)
 *   1:05pm  the movers video, the SAME file every other site posts at 1:05pm
 *   7:05pm  the evening picture post as a video (the all-games post)
 *
 * This file is the shared, pure part: settings keys, the row shape and its
 * parser. Server-only logic (staleness, registering, mail) is in
 * lib/server/socialTiktok.ts.
 *
 * The 7am and 7pm rows live in their OWN namespace, not in social_video:
 * (lib/socialVideo.ts), because a row there means "every site posts video in
 * this slot" and the other six sites keep posting those pictures live.
 */
export const TIKTOK_PREFIX = "social_tiktok:";
/**
 * Mark Posted: social_slot:tiktok:<slot>:<day> = "1". One key per slot AND day
 * (09-30 review): the card shows Tomorrow and Today at once, and a key per slot
 * holding a single day made marking tomorrow's 7:05am un-post today's.
 */
export const TIKTOK_POSTED_PREFIX = "social_slot:tiktok:";
/** The "package is ready" mail went out for this target day (once per day). */
export const TIKTOK_MAILED_PREFIX = "social_tiktok_mailed:";
/** The safety net dispatched a render for this target day: { at, n }. */
export const TIKTOK_DISPATCH_PREFIX = "social_tiktok_dispatch:";
/** The failure mail went out for this target day (value = the day; the publisher keys its own alerts as social_slot:alerted:<site>). */
export const TIKTOK_ALERTED_KEY = "social_slot:alerted:tiktok-videos";

export const TIKTOK_SLOTS: Slot[] = ["morning", "midday", "evening"];

/** settings key holding one slot's registered TikTok video for an Eastern day. */
export function tiktokKey(slot: Slot, day: string): string {
  return `${TIKTOK_PREFIX}${slot}:${day}`;
}

/** settings key that says whether Chris posted that slot on that day by hand ("1" = posted, "" = not). */
export function tiktokPostedKey(slot: Slot, day: string): string {
  return `${TIKTOK_POSTED_PREFIX}${slot}:${day}`;
}

/** One registered TikTok video with its caption. Extends the site video row so the movers file can be shared as is. */
export interface TiktokSpec extends VideoSpec {
  slot: Slot;
  /** The Eastern day the post is for (the settings key carries it too). */
  day: string;
  /** The draft the video shows, e.g. "Set spotlight: Base Set 2". */
  title: string;
  /** The full TikTok text, hashtags included, built at render time from the same data as the video. */
  caption: string;
  /** The day plan the video was made under; a row whose tag no longer matches is remade. */
  plan: string;
  /** The kind the video actually shows (the slot's own, or the publisher's fallback when the data was thin). */
  kind: PostKind;
  /** The backing track's file name, for the record. */
  audio?: string;
}

function isSlot(v: unknown): v is Slot {
  return v === "morning" || v === "midday" || v === "evening";
}

export function parseTiktokSpec(raw: string | null | undefined): TiktokSpec | null {
  const base = parseVideoSpec(raw);
  if (!base || !raw) return null;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (!isSlot(j.slot) || typeof j.caption !== "string" || !j.caption.trim() || typeof j.plan !== "string" || !base.kind) return null;
    return {
      ...base,
      slot: j.slot,
      day: typeof j.day === "string" ? j.day : "",
      title: typeof j.title === "string" ? j.title : "",
      caption: j.caption,
      plan: j.plan,
      kind: base.kind,
      audio: typeof j.audio === "string" ? j.audio : undefined,
    };
  } catch {
    return null;
  }
}

/** ready = made for the current plan; stale = made under a plan that changed since; missing = not made. */
export type PackageState = "ready" | "stale" | "missing";

/** One row of the hand-over card on /admin/social (plain data, safe to hand to the client). */
export interface PackageRow {
  slot: Slot;
  /** "7:05am ET" */
  time: string;
  state: PackageState;
  /** Chris marked it posted (social_slot:tiktok:<slot>:<day> = "1"). */
  posted: boolean;
  title: string | null;
  caption: string | null;
  url: string | null;
  seconds: number;
  bytes: number;
  /** For a row that is not ready: when it will be. */
  note: string | null;
}

export interface PackageDay {
  day: string;
  /** "Thu, Oct 1" */
  label: string;
  rows: PackageRow[];
}
