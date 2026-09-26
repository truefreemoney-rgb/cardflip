import type { GameId } from "@/lib/types";
import type { PostKind } from "@/lib/server/social";

/**
 * Social video (Chris 09-25: "we should try to incorporate this with the
 * other socials as well, that way we arent always posting static images").
 * The 7am set spotlight goes out as a 9:16 MP4: scripts/social-video.mjs
 * renders it in GitHub Actions before the post ping, parks it on Vercel
 * Blob and registers it in settings under videoKey(); the publisher picks
 * it up and every site adapter that can take video does, with the picture
 * as the fallback. Movers and drops stay pictures for now (variety).
 *
 * This file is the shared, pure part: timeline math and the settings key.
 */
export const VIDEO_W = 1080;
export const VIDEO_H = 1920;

/** Seconds: intro card, one beat per card, logo outro. */
export const TIMELINE = { intro: 2.2, beat: 2.1, outro: 2.6 } as const;

/** Total length for n cards, rounded to the millisecond (15.3s for five). */
export function videoSeconds(cards: number): number {
  return Math.round((TIMELINE.intro + TIMELINE.beat * cards + TIMELINE.outro) * 1000) / 1000;
}

/** Where in the video the beat for card index i (0 = first shown) starts. */
export function beatStart(i: number): number {
  return Math.round((TIMELINE.intro + i * TIMELINE.beat) * 1000) / 1000;
}

export const VIDEO_PREFIX = "social_video:";

/** settings key that holds the registered video for one draft (game + kind + day). */
export function videoKey(game: GameId, kind: PostKind, day: string): string {
  return `${VIDEO_PREFIX}${game}:${kind}:${day}`;
}

/**
 * One card as the video showed it (09-26: the exact list the render job
 * drew, frozen at register time, so the publisher's text can never drift
 * from the video — the "Mysterious Treasures" caption over Base Set 2 art
 * bug). Same shape as social.ts's Mover, minus imageUrl/unsettled (the
 * caption builders never need them).
 */
export interface VideoCard {
  cardId: string;
  name: string;
  number: string;
  setName: string;
  variant: string;
  from: number;
  to: number;
  pct: number;
}

function isVideoCard(v: unknown): v is VideoCard {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.cardId === "string" &&
    typeof c.name === "string" &&
    typeof c.number === "string" &&
    typeof c.setName === "string" &&
    typeof c.variant === "string" &&
    typeof c.from === "number" &&
    typeof c.to === "number" &&
    typeof c.pct === "number"
  );
}

/** What the render job registers; what the publisher hands the site adapters (bytes added). */
export interface VideoSpec {
  url: string;
  bytes: number;
  mime: "video/mp4";
  width: number;
  height: number;
  seconds: number;
  renderedAt: number;
  /** The draft kind this video was rendered for (09-26; older rows have none — the caller already knows the kind from the settings key). */
  kind?: PostKind;
  /** The exact cards the video drew, in the same order (09-26). Older rows have none: the publisher computes text fresh for those. */
  cards?: VideoCard[];
}

export function parseVideoSpec(raw: string | null | undefined): VideoSpec | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<VideoSpec>;
    if (typeof v.url !== "string" || !/^https:\/\//.test(v.url) || typeof v.bytes !== "number") return null;
    const cards = Array.isArray(v.cards) && v.cards.every(isVideoCard) ? v.cards : undefined;
    return {
      url: v.url,
      bytes: v.bytes,
      mime: "video/mp4",
      width: v.width ?? VIDEO_W,
      height: v.height ?? VIDEO_H,
      seconds: v.seconds ?? 0,
      renderedAt: v.renderedAt ?? 0,
      kind: typeof v.kind === "string" ? (v.kind as PostKind) : undefined,
      cards,
    };
  } catch {
    return null;
  }
}
