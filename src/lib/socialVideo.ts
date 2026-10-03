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
 * 09-30: TikTok left the autopilot (its app was refused for production, so
 * API posts stayed private) and Chris posts it by hand. Each night the same
 * render job builds tomorrow's three TikTok videos (lib/socialTiktok.ts):
 * the 1pm movers video is THIS registry's row (the file every site posts at
 * 1:05pm), the 7am set and 7pm all-games videos are TikTok-only rows in their
 * own namespace, so a video registered here still means "every site posts
 * video in that slot" and the TikTok ones never do.
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
  /** Set on a mixed-game video (day plan mixedMovers, 09-30); older rows have none. */
  game?: GameId;
  /** A set-spotlight card whose price had not held: no % is claimed for it (09-30, the 7am TikTok video). */
  unsettled?: boolean;
  /** A set-spotlight card's place by value among the five (1 = dearest): the video may open on the biggest riser instead (10-01), so the label keeps the value rank. */
  rank?: number;
  /** Then vs now (10-03): the day `from` was read; the caption says its month, so a rebuilt caption still says "May". */
  thenDay?: string;
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
    typeof c.pct === "number" &&
    (c.game === undefined || typeof c.game === "string") &&
    (c.unsettled === undefined || typeof c.unsettled === "boolean") &&
    (c.rank === undefined || typeof c.rank === "number") &&
    (c.thenDay === undefined || typeof c.thenDay === "string")
  );
}

/**
 * One game's lead card as the all-games video showed it (09-30, the 7pm
 * TikTok video). Frozen at render time like VideoCard, minus the art, so the
 * caption is rebuilt from what the video drew and not from a fresh pick.
 */
export interface LeadCard {
  game: GameId;
  name: string;
  setName: string;
  number: string;
  price: number;
  /** Set on a game's biggest weekly jump (10-01, social.ts gameJumps): the card id, the price a week ago, the move in % and the price variant. A plain lead card has none. */
  cardId?: string;
  from?: number;
  pct?: number;
  variant?: string;
}

function isLeadCard(v: unknown): v is LeadCard {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.game === "string" &&
    typeof c.name === "string" &&
    typeof c.setName === "string" &&
    typeof c.number === "string" &&
    typeof c.price === "number" &&
    (c.cardId === undefined || typeof c.cardId === "string") &&
    (c.from === undefined || typeof c.from === "number") &&
    (c.pct === undefined || typeof c.pct === "number") &&
    (c.variant === undefined || typeof c.variant === "string")
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
  /** The exact lead cards an all-games video drew, in order (TikTok 7pm). */
  leads?: LeadCard[];
  /** The day plan the video was made under (socialTiktok.ts planTag); a row whose tag no longer matches is remade. Older rows have none and count as fresh. */
  plan?: string;
  /** Head to head (10-03): which of the two frozen cards the video crowned (0 = the first), so the rebuilt verdict matches the screen. */
  winner?: 0 | 1;
}

export function parseVideoSpec(raw: string | null | undefined): VideoSpec | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<VideoSpec>;
    if (typeof v.url !== "string" || !/^https:\/\//.test(v.url) || typeof v.bytes !== "number") return null;
    const cards = Array.isArray(v.cards) && v.cards.every(isVideoCard) ? v.cards : undefined;
    const leads = Array.isArray(v.leads) && v.leads.every(isLeadCard) ? v.leads : undefined;
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
      leads,
      plan: typeof v.plan === "string" ? v.plan : undefined,
      winner: v.winner === 0 || v.winner === 1 ? v.winner : undefined,
    };
  } catch {
    return null;
  }
}
