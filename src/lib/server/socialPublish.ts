import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { GATED_GAMES, gamePublic, getSetting, setSetting, type GatedGame } from "@/lib/server/settings";
import {
  angleDraft,
  featuredByGame,
  markFeatured,
  moversFromCards,
  pairFromCards,
  socialDrafts,
  POST_SIZES,
  mixedMoversCaption,
  mixedMoversShortCaption,
  moversCaption,
  moversShortCaption,
  dipsCaption,
  dipsShortCaption,
  gamesCaption,
  gamesShortCaption,
  gamesTitle,
  isJump,
  setCaption,
  setShortCaption,
  storeDraftsCache,
  type FeaturedKind,
  type GameLead,
  type Mover,
  type PostKind,
  type SocialPost,
} from "@/lib/server/social";
import { dayPlan, fillTags, gamesTags, isAngleKind, jumpsOn, plannedGame, questionFor, slotFormat } from "@/lib/socialPlan";
import { ensureSchedule } from "@/lib/server/socialSchedule";
import { tagsOn } from "@/lib/socialTags";
import { draftCampaign } from "@/lib/attribution";
import { BoardConflictError, COMPLETED_TITLE, isCompletedSection, loadBoard, saveBoard } from "@/lib/server/board";
import { parseVideoSpec, videoKey, type LeadCard, type VideoCard, type VideoSpec } from "@/lib/socialVideo";
import type { GameId } from "@/lib/types";

/**
 * Social autopilot — the publisher (docs/SOCIAL-AUTOPILOT.md §1). Runs as
 * the last step of the daily Pokémon cron (Hobby plan = two crons, so it
 * rides along) and from GET/POST /api/social/publish?key=CRON_SECRET.
 *
 * Every connected site gets one picture per slot (7am card of the day,
 * 1pm movers, 7pm price drops, Eastern; see SLOTS), at most once per slot
 * per day, from the GitHub Actions schedule or a forced Post now. A
 * site is "connected" when its env vars exist — Chris pastes one token on
 * his board row, I put it on Vercel, nothing else. Each run leaves one
 * line on the board's Completed list so Chris sees what went out without
 * opening any social site.
 *
 * TikTok is NOT a site here any more (Chris 09-30): its developer app was
 * refused for production ("personal use or internal company use"), so API
 * posts would stay private forever, and he chose to post it by hand. The
 * three TikTok videos a day are built the night before by the render job
 * and shown on /admin/social (lib/socialTiktok.ts). Nothing in this file
 * uploads to TikTok, alerts about it or marks a slot failed for it.
 */
export const LAST_POST_PREFIX = "social_last_post:";

/**
 * Three posts a day (Chris 09-25: 7am / 1pm / 7pm, hands off). Each slot
 * posts ONE draft kind; a slot posts at most once per Eastern day
 * (settings key social_slot:<site>:<slot> = the ET day). The GitHub
 * Actions schedule (.github/workflows/social-post.yml) pings the publish
 * route around each hour in both DST offsets; the guard makes the second
 * ping a no-op.
 */
export type Slot = "morning" | "midday" | "evening";
/**
 * The movers VIDEO goes out at 1pm (Chris 09-27: "switch the video to 1pm";
 * it ran at 7am from 09-26, when he asked for "the biggest movers and
 * shakers" so the countdown has something worth ranking No.5 → No.1).
 * Morning is the set spotlight picture; evening is the all-five-games
 * picture every day (Chris 09-30: "the 7pm post is supposed to feature all
 * 5 … every day for now until i come up with a different plan"; it was the
 * drops picture). VIDEO_SLOT is the one slot the render job
 * (scripts/social-video.mjs) and its safety net (/api/cron/social-video) key
 * on; move the slot here and the schedules in social-post.yml + vercel.json
 * together. Since 09-30 the night render (8pm ET, /api/cron/social-tiktok is
 * its net) builds tomorrow's VIDEO_SLOT video too, so the morning renders
 * only run when that one is missing.
 */
export const VIDEO_SLOT: Slot = "midday";
export const SLOTS: Record<Slot, { hour: number; kind: PostKind; label: string }> = {
  morning: { hour: 7, kind: "set", label: "7am set spotlight" },
  midday: { hour: 13, kind: "movers", label: "1pm movers of the week" },
  evening: { hour: 19, kind: "games", label: "7pm all five games" },
};
/**
 * Never skip a slot (Chris 09-30: "never skip posts, i dont care the
 * excuse, 3 a day and the specific times"): when a slot's own kind has no
 * draft that day (a thin set list, too few held movers), it posts the first
 * of these that has one. The all-games picture comes first: it needs only
 * the scanner-stage cards, so it is there every day.
 */
export const FALLBACK_KINDS: PostKind[] = ["games", "set", "movers", "dips"];
export const SLOT_ORDER: Slot[] = ["morning", "midday", "evening"];

/** The kind a slot posts on an Eastern day: SLOTS, unless that day's plan (lib/socialPlan.ts) says otherwise. */
export function slotKind(slot: Slot, day: string): PostKind {
  const plan = dayPlan(day);
  return (slot === "morning" ? plan.morning : slot === "evening" ? plan.evening : plan.midday) ?? SLOTS[slot].kind;
}
/**
 * The kinds that post on an Eastern day: one per slot, no spares (Chris 10-03:
 * "only create what we are going to use, nothing extra"). Callers pass this to
 * socialDrafts so nothing else is drafted. Call ensureSchedule() first.
 */
export function dayKinds(day: string): PostKind[] {
  return [...new Set(SLOT_ORDER.map((s) => slotKind(s, day)))];
}
/**
 * When each kind goes live on an Eastern day, for the /admin/social cards
 * (Chris 09-30: "put a time/date on the preview posts"): "Wed, Sep 30 ·
 * 7:05am ET" (the crons fire at :05) and whether that moment has passed.
 * A kind with no slot that day is absent (a spare draft that does not post).
 */
export function slotSchedule(day: string, now = Date.now()): Partial<Record<PostKind, { slot: Slot; when: string; past: boolean }>> {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ET_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const nowEt = `${get("year")}-${get("month")}-${get("day")} ${String(Number(get("hour")) % 24).padStart(2, "0")}:${get("minute")}`;
  const date = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const out: Partial<Record<PostKind, { slot: Slot; when: string; past: boolean }>> = {};
  for (const slot of SLOT_ORDER) {
    const h = SLOTS[slot].hour;
    out[slotKind(slot, day)] = { slot, when: `${date} · ${slotTimeLabel(slot)} ET`, past: nowEt >= `${day} ${String(h).padStart(2, "0")}:05` };
  }
  return out;
}
const KIND_LABEL: Record<PostKind, string> = {
  set: "set spotlight",
  movers: "movers of the week",
  games: "all five games",
  dips: "price drops",
  card: "card of the day",
  guess: "guess the price",
  thennow: "then vs now",
  versus: "head to head",
  sleepers: "sleepers under $5",
  top: "most valuable",
};
/**
 * "7am set spotlight" for what the slot ACTUALLY posts that day: the optimizer
 * (lib/server/socialOptimize.ts) and DAY_PLANS can put another kind in the
 * 7am or 7pm slot, and SLOTS[slot].label only knows the default. Call
 * ensureSchedule() first where the schedule may not be loaded.
 */
export function slotLabel(slot: Slot, day: string): string {
  const h = SLOTS[slot].hour;
  return `${h % 12 || 12}${h < 12 ? "am" : "pm"} ${KIND_LABEL[slotKind(slot, day)] ?? SLOTS[slot].label}`;
}
/** "7:05am" / "1:05pm" / "7:05pm": the crons fire at :05 (callers add " ET" where it is shown). */
export function slotTimeLabel(slot: Slot): string {
  const h = SLOTS[slot].hour;
  return `${h % 12 || 12}:05${h < 12 ? "am" : "pm"}`;
}
export const SLOT_PREFIX = "social_slot:";
export const ET_ZONE = "America/New_York";

/**
 * Same-day dedupe BY KIND (09-26): the day the slot→kind mapping changes,
 * a kind already posted this Eastern day under its old slot must not post
 * again under its new slot. settings key social_kind:<site>:<kind> = the
 * ET day, written alongside the slot key. When a slot's kind was already
 * posted today, the next kind in this rotation not yet posted today runs
 * instead — a slot always posts something; dedupe only picks WHAT.
 */
export const KIND_PREFIX = "social_kind:";
export const KIND_ROTATION: PostKind[] = ["movers", "set", "games", "dips"];
function nextKindInRotation(kind: PostKind): PostKind {
  const i = KIND_ROTATION.indexOf(kind);
  return KIND_ROTATION[(i + 1) % KIND_ROTATION.length];
}

/** Eastern day (YYYY-MM-DD) and hour for a timestamp. */
export function eastern(now = Date.now()): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ET_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }).formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

/** The slot whose hour is within an hour after now (7-8am → morning), else null. */
export function slotAt(now = Date.now()): Slot | null {
  const { hour } = eastern(now);
  return SLOT_ORDER.find((s) => hour === SLOTS[s].hour || hour === SLOTS[s].hour + 1) ?? null;
}
/**
 * Games the autopilot posts about. Pokémon only (Chris 09-25: "as far as the
 * public is concerned, the site is Pokémon only"). Add a game here AND it
 * must be switched on for the public before it is drafted (socialGames).
 */
export const GAMES: GameId[] = ["pokemon"];

/** GAMES, minus any gated game whose public switch is still off. */
export async function socialGames(): Promise<GameId[]> {
  const out: GameId[] = [];
  for (const g of GAMES) {
    const gated = (GATED_GAMES as readonly string[]).includes(g);
    if (!gated || (await gamePublic(g as GatedGame))) out.push(g);
  }
  return out;
}

/** A rendered MP4 for the post (lib/socialVideo.ts). Sites that take video post it and use the picture only as the fallback. */
export interface SitePostVideo {
  url: string;
  bytes: Buffer;
  mime: "video/mp4";
  width: number;
  height: number;
  seconds: number;
}

export interface SitePost {
  text: string;
  image: Buffer;
  mime: string;
  width: number;
  height: number;
  alt: string;
  video?: SitePostVideo;
  /** The draft's campaign ("mtg-movers-0930", lib/attribution.ts draftCampaign), for sites that tag a link themselves (Bluesky's facet, Pinterest's link field). Never shown in the text. */
  campaign?: string;
}

export interface SocialSite {
  id: string;
  label: string;
  /** Post length the site allows; captions are fitted to it. */
  maxChars: number;
  /** Most hashtags the site accepts (Instagram: 5); the tag list is cut from the end to it. */
  maxTags?: number;
  maxImageBytes: number;
  /** True when post() knows what to do with p.video; the publisher only fetches the MP4 for these. */
  postsVideo?: boolean;
  /** Env vars exist (Chris pasted the app or token). */
  connected(): boolean;
  /** OAuth sites: the account has been connected in the browser (tokens in settings). Missing = connected() is enough. */
  authorized?(): Promise<boolean>;
  /** OAuth sites: where /admin/social sends the owner to connect the account. */
  connectPath?: string;
  post(p: SitePost): Promise<{ uri: string }>;
}

export interface SiteReport {
  site: string;
  label: string;
  status: "posted" | "skipped" | "dry" | "failed";
  reason?: string;
  /** failed again on a later ping of the same slot; the board already has the first failure, so noteOnBoard leaves it out. */
  repeat?: boolean;
  /** video: "yes" = the MP4 went out; "fallback" = the video upload failed and the picture went instead (error says why). */
  posts: Array<{ id: string; title: string; uri?: string; error?: string; video?: "yes" | "fallback" }>;
}

export interface PublishReport {
  day: string;
  /** Eastern day the slot guard is keyed on. */
  etDay: string;
  slot: Slot | null;
  forced: boolean;
  drafts: number;
  sites: SiteReport[];
}

/**
 * Caption + hashtags, shortened until it fits the site's limit. Hashtags
 * outrank the long caption (Chris 09-30: "make sure to use hashtags to tag
 * all the posts"): full caption with every tag, then the short caption with
 * every tag, then either with the tag list trimmed from the end (never
 * under two), and only then untagged text.
 * The engagement question (10-01, post.question) is the lowest priority
 * there is after the sign-off cut: every version above is tried WITH it first,
 * and only when none fits does it go, still before a single hashtag does.
 */
/** The caption builders' closing line (lib/server/social.ts SIGN_OFF); leadSignOff moves it to the top. */
export const SIGN_OFF_LINE = "Scan a card, see what it's worth. cardflip.io";

/**
 * The sign-off LEADS every post (Chris 10-02 for TikTok, 10-03 for every site:
 * "we need to start putting this at the top of descriptions"). The builders
 * still write it last (fitText cuts from the end and must keep it); this moves
 * the exact SIGN_OFF line to the front, one blank line after it. A short form
 * ("Also scans Magic ... cardflip.io") or a bare "cardflip.io" stays where it is.
 */
export function leadSignOff(text: string): string {
  const lines = text.split("\n");
  const i = lines.indexOf(SIGN_OFF_LINE);
  if (i <= 0) return text;
  lines.splice(i, 1);
  // The sign-off left a blank before the hashtags; keep one blank between the body and the tags.
  const body = lines.join("\n").replace(/\n\n\n+/g, "\n\n").replace(/\n+$/, "");
  return `${SIGN_OFF_LINE}\n\n${body}`;
}

export function fitText(post: SocialPost, maxChars: number, maxTags = Infinity): string {
  return leadSignOff(fitTextRaw(post, maxChars, maxTags));
}

function fitTextRaw(post: SocialPost, maxChars: number, maxTags = Infinity): string {
  // The optimizer's hashtag plan (lib/socialTags.ts): the one place a post's tags are resolved for its day.
  post = { ...post, hashtags: tagsOn(post.hashtags, post.day) };
  if (post.hashtags.length > maxTags) post = { ...post, hashtags: post.hashtags.slice(0, maxTags) };
  const short = post.shortCaption ?? post.caption;
  // Before any tag goes: the short caption with its sign-off cut to the
  // address ("Also scans Magic, Lorcana, One Piece and Yu-Gi-Oh. cardflip.io"
  // → "cardflip.io"; the picture still carries the pills).
  const cut = short.lastIndexOf("\n");
  // The address leads too (10-03: the sign-off goes at the top everywhere, even when cut to the bare address).
  const tiny = cut > 0 && short.endsWith("cardflip.io") ? `cardflip.io\n\n${short.slice(0, cut).trimEnd()}` : short;
  const withQ = tiny === short ? [post.caption, short] : [post.caption, short, tiny];
  const q = post.question;
  // The question sits before the sign-off, or last once the address leads (10-03): either way it comes out whole.
  const noQ = (t: string) => (q ? t.replace(`${q}\n\n`, "").replace(`\n\n${q}`, "") : t);
  const texts = q ? [...withQ, ...withQ.map(noQ)] : withQ;
  for (let n = post.hashtags.length; n >= Math.min(2, post.hashtags.length); n--) {
    const tags = post.hashtags.slice(0, n).map((h) => `#${h}`).join(" ");
    for (const text of texts) {
      const tagged = n > 0 ? `${text}\n\n${tags}` : text;
      if (tagged.length <= maxChars) return tagged;
    }
    if (n === 0) break;
  }
  if (post.caption.length <= maxChars) return post.caption;
  if (short.length <= maxChars) return short;
  // Last resort: cut on a line boundary and keep the address, leading (10-03).
  const signOff = "cardflip.io";
  const lines = short.split("\n");
  let out = "";
  for (const line of lines) {
    if (`${out}${line}\n${signOff}`.length > maxChars) break;
    out += `${line}\n`;
  }
  return `${signOff}\n\n${out.trimEnd()}`;
}

/** Shrink a PNG below the site's byte cap (JPEG, falling quality). */
async function fitImage(png: Buffer, maxBytes: number): Promise<{ bytes: Buffer; mime: string }> {
  if (png.length <= maxBytes) return { bytes: png, mime: "image/png" };
  const sharp = (await import("sharp")).default;
  for (const quality of [88, 78, 68, 58]) {
    const jpg = await sharp(png).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (jpg.length <= maxBytes) return { bytes: jpg, mime: "image/jpeg" };
  }
  throw new Error(`image still above ${maxBytes} bytes at quality 58`);
}

export interface PublishOptions {
  day?: string;
  /**
   * Which slot to post. Omitted → the slot for the current Eastern hour
   * (null outside the slot windows → nothing posts unless forced, in
   * which case the first slot not yet posted today, else morning).
   */
  slot?: Slot;
  force?: boolean;
  /** Report what would go out; touch nothing. */
  dry?: boolean;
  /** Where to fetch the pictures from (this deployment's own origin). */
  origin: string;
  sites: SocialSite[];
  fetchImage?: (url: string, headers?: Record<string, string>) => Promise<Buffer>;
  /** Fetches a registered MP4 from Blob (test hook). */
  fetchVideo?: (url: string) => Promise<Buffer>;
  now?: number;
}

async function defaultFetchImage(url: string, headers?: Record<string, string>): Promise<Buffer> {
  const res = await fetch(url, { cache: "no-store", headers, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`image ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
async function defaultFetchVideo(url: string): Promise<Buffer> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(40_000) });
  if (!res.ok) throw new Error(`video ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * The plan a slot's video was made under: its kind plus the day-plan flags
 * that change what the video or its caption says. Stored on the row; a row
 * whose tag differs from the current one is stale and gets remade.
 */
export function planTag(slot: Slot, day: string): string {
  const p = dayPlan(day);
  const kind = slotKind(slot, day);
  // An angle carries its game ("guess@mtg", phase 3): a changed pick remakes the video.
  const game = plannedGame(kind, day);
  // "jumps" / "lead" (10-01): the 7pm post is each game's biggest jump and the set spotlight leads with its biggest riser, so a video
  // made before that rule is stale (the render safety net remakes it) and one made after it is not.
  return [game ? `${kind}@${game}` : kind, kind === "movers" && p.mixedMovers ? "mixed" : "", kind !== "games" && p.alsoScans ? "also" : "", kind === "set" && p.set ? `set=${p.set}` : "", kind === "games" && jumpsOn(day) ? "jumps" : "", kind === "set" && jumpsOn(day) ? "lead" : ""].filter(Boolean).join("+");
}

/** The MP4 registered for a draft by the render job, or null (picture post). */
export async function videoFor(d: Pick<SocialPost, "game" | "kind" | "day">): Promise<VideoSpec | null> {
  return parseVideoSpec(await getSetting(videoKey(d.game, d.kind, d.day)));
}

/**
 * videoFor, unless the video was made under a day plan that has since changed
 * (a plan pushed after the night render: 09-30 review). Its cards are the old
 * plan's, its caption would be rebuilt from them under the new plan's title
 * and hashtags, and the filed "featured" list would name cards that never
 * went out, so the post falls back to the picture (drawn fresh) until the
 * render is redone. Rows from before rows carried a plan count as current.
 */
export async function currentVideoFor(d: Pick<SocialPost, "game" | "kind" | "day">): Promise<VideoSpec | null> {
  const spec = await videoFor(d);
  // The plan it must match is the one of the slot that posts this kind today (10-03: every slot shares its video, not just 1pm).
  const slot = SLOT_ORDER.find((s) => slotKind(s, d.day) === d.kind);
  if (spec?.plan && slot && spec.plan !== planTag(slot, d.day)) return null;
  return spec;
}

/**
 * The cards a registered video froze, as the picture posts should draw them.
 * The video is rendered the evening before (the night render), the picture at
 * 1:05pm, and the daily price ingestion runs in between: without this the
 * picture showed the morning's prices and a different top five while the
 * caption (frozen with the video) named the evening's: the 09-26 "Mysterious
 * Treasures over Base Set 2" mismatch again, on every picture-only site and on
 * every "video failed, picture posted". null = no current video, or a frozen
 * card that is no longer in the catalog: the caller draws the live list.
 */
export async function frozenMovers(game: GameId, kind: PostKind, day: string): Promise<Mover[] | null> {
  if (kind !== "movers" && kind !== "dips") return null;
  const spec = await currentVideoFor({ game, kind, day });
  return spec?.cards?.length ? moversFromCards(game, spec.cards) : null;
}

/**
 * Rebuild a draft's caption from the EXACT cards a registered video drew
 * (09-26: text and video must always agree — the "Mysterious Treasures"
 * caption over Base Set 2 art bug came from the picture and the video
 * computing their own card lists at different times). VideoCard drops
 * imageUrl/unsettled; the caption builders never read either.
 */
export function applyVideoCards(d: SocialPost, cards: VideoCard[], { winner }: { winner?: 0 | 1 } = {}): SocialPost {
  const movers: Mover[] = cards.map((c) => ({ ...c, imageUrl: "", unsettled: Boolean(c.unsettled) }));
  if (movers.length === 0) return d;
  // An angle (10-03): the draft is rebuilt whole from the frozen cards through the same builder socialDrafts uses, so the
  // title, both captions, the tags and the no-repeat list all say what the video shows (a mixed video's cards carry their game).
  if (isAngleKind(d.kind)) {
    const pair = d.kind === "versus" ? pairFromCards(d.game, movers, winner) : undefined;
    if (d.kind === "versus" && !pair) return d;
    const rebuilt = angleDraft({ kind: d.kind, game: d.game, mixed: Boolean(d.mixed) || movers.some((m) => m.game), cards: movers, ...(pair ? { pair } : {}) }, d.day);
    return { ...d, ...rebuilt, id: d.id, imagePath: d.imagePath };
  }
  // A video whose cards carry a game is a mixed one (day plan mixedMovers):
  // the draft's title and hashtags already say so, the text is rebuilt per game.
  const mixed = movers.some((m) => m.game);
  const also = Boolean(dayPlan(d.day).alsoScans) && d.game === "pokemon";
  const q = questionFor(d.kind, d.day);
  if (d.kind === "movers" && mixed) {
    return { ...d, caption: mixedMoversCaption(movers, q), shortCaption: mixedMoversShortCaption(movers, q), question: q, cardIds: movers.map((m) => m.cardId), featured: featuredByGame(movers) };
  }
  if (d.kind === "movers") {
    return { ...d, caption: moversCaption(d.game, movers, also, q), shortCaption: moversShortCaption(d.game, movers, also, q), question: q, cardIds: movers.map((m) => m.cardId) };
  }
  if (d.kind === "dips") {
    return { ...d, caption: dipsCaption(d.game, movers, also, q), shortCaption: dipsShortCaption(d.game, movers, also, q), question: q, cardIds: movers.map((m) => m.cardId) };
  }
  if (d.kind === "set") {
    const setName = movers[0].setName;
    const spot = { setId: "", setName, cards: movers };
    // The question names the set, so it follows the set the video drew (the draft's own may be another one).
    const sq = questionFor("set", d.day, setName);
    return { ...d, title: `Set spotlight: ${setName}`, caption: setCaption(d.game, spot, also, sq), shortCaption: setShortCaption(d.game, spot, also, sq), question: sq, cardIds: movers.map((m) => m.cardId) };
  }
  return d;
}

/**
 * The all-games draft rebuilt from the exact lead cards a video drew (the 7pm
 * TikTok video, 09-30), the same guarantee applyVideoCards gives the movers:
 * the caption names what the video showed, not a fresh pick.
 */
export function applyGameLeads(d: SocialPost, leads: LeadCard[]): SocialPost {
  if (d.kind !== "games" || leads.length < 3) return d;
  const full: GameLead[] = leads.map((l) => ({ ...l, imageUrl: "" }));
  const q = questionFor("games", d.day);
  // A jump video's cards are filed for the no-repeat rule like the draft's own (a lead card carries no id and files nothing).
  const jumped = full.filter((l) => isJump(l) && l.cardId);
  const featured = jumped.length ? featuredByGame(jumped.map((l) => ({ cardId: l.cardId as string, game: l.game }))) : undefined;
  return {
    ...d,
    title: gamesTitle(full),
    caption: gamesCaption(full, q),
    shortCaption: gamesShortCaption(full, q),
    question: q,
    hashtags: gamesTags(full.map((l) => l.game)),
    cardIds: jumped.map((l) => l.cardId as string),
    ...(featured ? { featured } : { featured: undefined }),
  };
}

/** Sites that can post right now: env vars present and, for OAuth sites, the account connected. */
export async function connectedSites(sites: SocialSite[]): Promise<SocialSite[]> {
  const out: SocialSite[] = [];
  for (const s of sites) {
    if (!s.connected()) continue;
    if (s.authorized && !(await s.authorized().catch(() => false))) continue;
    out.push(s);
  }
  return out;
}

export async function publishSocial(opts: PublishOptions): Promise<PublishReport> {
  const now = opts.now ?? Date.now();
  const force = Boolean(opts.force);
  const { day: etDay, hour } = eastern(now);
  const day = opts.day ?? etDay;
  // The optimization loop's standing schedule (settings), before anything asks what a slot posts.
  await ensureSchedule();
  const connected = await connectedSites(opts.sites);
  const slotKey =(site: SocialSite, slot: Slot) => `${SLOT_PREFIX}${site.id}:${slot}`;
  const kindKey = (site: SocialSite, kind: PostKind) => `${KIND_PREFIX}${site.id}:${kind}`;
  // Slots due now: the named one, else every slot whose hour has passed
  // today. That is the catch-up rule (Chris 09-25: every platform gets the
  // same posts): a site connected at 3pm still gets the 7am and 1pm posts,
  // and a missed ping is made good by the next one. Before 7am nothing is due.
  const due: Slot[] = opts.slot ? [opts.slot] : SLOT_ORDER.filter((s) => hour >= SLOTS[s].hour);
  const slot = due[due.length - 1] ?? null;
  const report: PublishReport = { day, etDay, slot, forced: force, drafts: 0, sites: [] };
  for (const s of opts.sites) {
    if (!connected.includes(s)) report.sites.push({ site: s.id, label: s.label, status: "skipped", reason: "not connected", posts: [] });
  }
  if (connected.length === 0) return report;
  if (!slot) {
    for (const s of connected) report.sites.push({ site: s.id, label: s.label, status: "skipped", reason: "before the 7am window", posts: [] });
    return report;
  }
  const games = await socialGames();
  // Only the kinds that post today are drafted (Chris 10-03: nothing extra); the
  // fallbacks are drafted only if a slot's own kind cannot be (never skip).
  const kinds = dayKinds(day);
  const buildFor = async (list: PostKind[], cache: boolean): Promise<SocialPost[]> =>
    (
      await Promise.all(
        games.map(async (g) => {
          const built = await socialDrafts(g, day, list);
          // The build /admin/social shows until its next one (lib/server/social.ts cachedSocialDrafts); a failed write never costs the post.
          if (cache && !opts.dry) await storeDraftsCache(g, day, built, now).catch((err) => console.warn("social: drafts cache write failed", err instanceof Error ? err.message : err));
          return built;
        }),
      )
    ).flat();
  // Text must always match a registered video (09-26: a caption once named
  // "Mysterious Treasures" over Base Set 2 art, because the picture and the
  // video each computed the card list at a different moment). When a video
  // is registered for a draft, rebuild its caption from the EXACT cards the
  // video drew, frozen at render time; a draft with no video is computed
  // fresh, same as always.
  const withVideoCards = (list: SocialPost[]): Promise<SocialPost[]> =>
    Promise.all(
      list.map(async (d) => {
        const spec = await currentVideoFor(d);
        return spec?.cards?.length ? applyVideoCards(d, spec.cards, { winner: spec.winner }) : spec?.leads?.length ? applyGameLeads(d, spec.leads) : d;
      }),
    );
  const all = await withVideoCards(await buildFor(kinds, true));
  let fallbacks: SocialPost[] | null = null;
  async function draftsForKind(kind: PostKind): Promise<SocialPost[]> {
    // An angle draft carries the game the optimizer picked (guess@mtg, versus@yugioh); the per-game filter dropped it and
    // the slot fell back to "games" every time (10-04 evening, 10-05 morning). Angles keep their own game.
    const from = (list: SocialPost[]) =>
      isAngleKind(kind)
        ? list.filter((d) => d.kind === kind).slice(0, 1)
        : games.map((g) => list.find((d) => d.game === g && d.kind === kind)).filter((d): d is SocialPost => Boolean(d));
    if (kinds.includes(kind)) return from(all);
    fallbacks ??= await withVideoCards(await buildFor(FALLBACK_KINDS.filter((k) => !kinds.includes(k)), false));
    return from(fallbacks);
  }
  // One draft per game per slot, of that slot's kind; a kind with no draft
  // today falls through FALLBACK_KINDS so the slot still posts (never skip).
  const plan: Array<{ slot: Slot; kind: PostKind; drafts: SocialPost[] }> = [];
  for (const s of due) {
    const own = slotKind(s, day);
    for (const kind of [own, ...FALLBACK_KINDS.filter((k) => k !== own)]) {
      const drafts = await draftsForKind(kind);
      if (drafts.length > 0) {
        if (kind !== own) console.warn(`social: ${s} ${day} planned ${own} had no draft, posting ${kind} instead`);
        plan.push({ slot: s, kind, drafts });
        break;
      }
    }
  }
  report.drafts = plan.reduce((n, p) => n + p.drafts.length, 0);
  if (report.drafts === 0) {
    for (const s of connected) report.sites.push({ site: s.id, label: s.label, status: "skipped", reason: "nothing to post", posts: [] });
    return report;
  }
  const fetchImage = opts.fetchImage ?? defaultFetchImage;
  const fetchVideo = opts.fetchVideo ?? defaultFetchVideo;
  const key = process.env.CRON_SECRET ?? "";
  // Sites post in parallel (video polling on Meta takes minutes), so the
  // per-draft fetches are memoized as promises: one image and one video
  // fetch per draft per run, whoever asks first.
  const images = new Map<string, Promise<Buffer>>();
  function pngFor(d: SocialPost): Promise<Buffer> {
    let p = images.get(d.id);
    if (!p) {
      // The key rides a header, never the URL (10-01 sweep: ?key= put CRON_SECRET in the request logs six times a day).
      p = fetchImage(`${opts.origin}${d.imagePath}&size=square`, { authorization: `Bearer ${key}` });
      images.set(d.id, p);
    }
    return p;
  }
  const videos = new Map<string, Promise<SitePostVideo | null>>();
  function videoOf(d: SocialPost): Promise<SitePostVideo | null> {
    let p = videos.get(d.id);
    if (!p) {
      p = (async () => {
        const spec = await currentVideoFor(d);
        if (!spec) return null;
        try {
          const bytes = await fetchVideo(spec.url);
          return { url: spec.url, bytes, mime: "video/mp4", width: spec.width, height: spec.height, seconds: spec.seconds };
        } catch (err) {
          console.warn("social: video fetch failed, posting the picture", err instanceof Error ? err.message : err);
          return null;
        }
      })();
      videos.set(d.id, p);
    }
    return p;
  }

  async function postOne(site: SocialSite, d: SocialPost, text: string, slot: Slot): Promise<{ uri: string; video?: "yes" | "fallback"; error?: string }> {
    const png = await pngFor(d);
    const img = await fitImage(png, site.maxImageBytes);
    const base: SitePost = {
      text,
      image: img.bytes,
      mime: img.mime,
      width: POST_SIZES.square.width,
      height: POST_SIZES.square.height,
      alt: `${d.title}. ${d.caption.split("\n")[0]}`,
      campaign: draftCampaign(d.id),
    };
    // The slot's format (phase 5): the optimizer may make a slot the picture now and then, on the sites that take both.
    const video = site.postsVideo && slotFormat(slot, day) === "video" ? await videoOf(d) : null;
    if (!video) return site.post(base);
    try {
      // The all-games caption is written for the picture; with the file attached it is a video (the picture fallback below keeps the picture wording).
      const { uri } = await site.post({ ...base, text: text.replace(/^In the picture,/m, "In the video,"), video });
      return { uri, video: "yes" };
    } catch (err) {
      // Video is the upgrade, the picture is the post: never lose the slot to a video upload.
      const reason = err instanceof Error ? err.message : String(err);
      const { uri } = await site.post(base);
      return { uri, video: "fallback", error: `video failed, picture posted: ${reason}` };
    }
  }

  async function postSite(site: SocialSite): Promise<SiteReport> {
    // What this site still owes today. A named slot with force re-posts it;
    // Post now (force, no slot) re-does the latest due slot when nothing is owed.
    let todo: typeof plan = [];
    for (const p of plan) {
      const done = (await getSetting(slotKey(site, p.slot))) === etDay;
      if (!done || (force && opts.slot)) todo.push(p);
    }
    if (todo.length === 0 && force) todo = plan.slice(-1);
    if (todo.length === 0) {
      const reason = plan.some((p) => p.slot === slot) ? `${slot} slot already posted today` : `nothing to post for the ${slot} slot`;
      return { site: site.id, label: site.label, status: "skipped", reason, posts: [] };
    }
    const entry: SiteReport = { site: site.id, label: site.label, status: opts.dry ? "dry" : "posted", posts: [] };
    for (const p of todo) {
      // Same-day dedupe BY KIND (09-26): only when this SITE has not posted
      // THIS SLOT yet today (a force re-post of an already-done slot must
      // repeat its own kind, not reroute) and that kind already went out
      // today under a DIFFERENT slot (the day the mapping changes, or a
      // late-connecting site catching up) — swap to the next kind in
      // KIND_ROTATION this site has not posted today.
      let kind = p.kind;
      let drafts = p.drafts;
      const slotAlreadyDone = (await getSetting(slotKey(site, p.slot))) === etDay;
      if (!slotAlreadyDone && (await getSetting(kindKey(site, kind))) === etDay) {
        let k = kind;
        for (let i = 1; i < KIND_ROTATION.length; i++) {
          k = nextKindInRotation(k);
          const done = (await getSetting(kindKey(site, k))) === etDay;
          const cand = await draftsForKind(k);
          if (!done && cand.length > 0) {
            kind = k;
            drafts = cand;
            break;
          }
        }
        // Every kind already posted today, or has no draft: keep the
        // slot's own kind and repeat it rather than skip the slot.
      }
      const landed: Array<{ uri: string; game: string; format: "video" | "picture" }> = [];
      for (const d of drafts) {
        // Filled to seven tags like TikTok (Chris 10-07: 5 to 7 on every post), then cut to the site's maxTags.
        const text = fitText({ ...d, hashtags: fillTags(d.hashtags, d.mixed ? "mixed" : d.game) }, site.maxChars, site.maxTags);
        if (opts.dry) {
          entry.posts.push({ id: d.id, title: d.title, video: site.postsVideo && slotFormat(p.slot, day) === "video" && (await currentVideoFor(d)) ? "yes" : undefined });
          continue;
        }
        try {
          const r = await postOne(site, d, text, p.slot);
          entry.posts.push({ id: d.id, title: d.title, uri: r.uri, ...(r.video ? { video: r.video } : {}), ...(r.error ? { error: r.error } : {}) });
          landed.push({ uri: r.uri, game: d.mixed ? "mixed" : d.game, format: r.video === "yes" ? "video" : "picture" });
        } catch (err) {
          entry.posts.push({ id: d.id, title: d.title, error: err instanceof Error ? err.message : String(err) });
        }
      }
      if (!opts.dry && landed.length > 0) {
        await setSetting(slotKey(site, p.slot), etDay);
        await setSetting(kindKey(site, kind), etDay);
        // What went out as what, for the optimization loop (social_post_log): kind, slot, game and format. A failed write never costs the post.
        try {
          const log = db.prepare("INSERT OR REPLACE INTO social_post_log (site, url, day, slot, kind, at, game, format) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
          for (const l of landed) await log.run(site.id, l.uri, etDay, p.slot, kind, now, l.game, l.format);
        } catch (err) {
          console.warn("social: post log write failed", err instanceof Error ? err.message : err);
        }
      }
    }
    if (!opts.dry) {
      const posted = entry.posts.filter((p) => p.uri);
      if (posted.length === 0) {
        entry.status = "failed";
        // A site that never lands (Pinterest on Trial access) is retried on every
        // backstop ping of the slot, which is wanted; logging it each time is not.
        const failKey = `${SLOT_PREFIX}failed:${site.id}:${todo.map((p) => p.slot).join("+")}`;
        if ((await getSetting(failKey)) === etDay) entry.repeat = true;
        else await setSetting(failKey, etDay);
      } else {
        // Same Eastern day = the 7am/1pm/7pm slots add up (Chris 09-26: the
        // analytics tile said "1 post" after three); a new day starts over.
        let uris: string[] = [];
        if ((await getSetting(`${LAST_POST_PREFIX}${site.id}`)) === etDay) {
          try {
            uris = JSON.parse((await getSetting(`${LAST_POST_PREFIX}${site.id}:uris`)) ?? "[]") as string[];
          } catch {
            uris = [];
          }
        }
        for (const p of posted) if (p.uri && !uris.includes(p.uri)) uris.push(p.uri);
        await setSetting(`${LAST_POST_PREFIX}${site.id}`, etDay);
        await setSetting(`${LAST_POST_PREFIX}${site.id}:uris`, JSON.stringify(uris));
      }
    }
    return entry;
  }

  // Every connected site at once; the report keeps the sites' order.
  report.sites.push(...(await Promise.all(connected.map(postSite))));
  if (!opts.dry) {
    // No-repeat rule: every gains/drops draft that landed anywhere keeps its cards out of that kind for FEATURED_DAYS.
    // The 7pm all-games post files its per-game jumps under their own "jumps" list (a lead card has no id and files nothing).
    const landedIds = new Set(report.sites.flatMap((s) => s.posts.filter((p) => p.uri).map((p) => p.id)));
    for (const d of all) {
      // The five angles (10-03) file under their own kind too, so a card that led "guess the price" sits out the next week of it.
      if ((d.kind !== "movers" && d.kind !== "dips" && d.kind !== "games" && !isAngleKind(d.kind)) || !landedIds.has(d.id)) continue;
      if (d.kind === "games" && !d.featured) continue;
      // A mixed post files each card under its own game's list (a Magic card under Pokémon's would repeat on Magic's next post).
      const byGame = d.featured ?? { [d.game]: d.cardIds };
      const list: FeaturedKind = d.kind === "games" ? "jumps" : (d.kind as FeaturedKind);
      for (const [g, ids] of Object.entries(byGame) as [GameId, string[]][]) await markFeatured(g, list, day, ids);
    }
    await noteOnBoard(report, now);
    await alertFailures(report).catch((err) => console.warn("social: failure alert skipped", err instanceof Error ? err.message : err));
  }
  return report;
}

/**
 * Email Chris the day a site that USED to post starts failing (09-29:
 * Facebook's token died 09-28 and nobody noticed for a day; the board line
 * is not an alert). A site that never posted (Pinterest on Trial access) is
 * a known state, not news. One mail per site per Eastern day.
 */
export async function alertFailures(
  report: PublishReport,
  deps: {
    get?: (k: string) => Promise<string | null>;
    set?: (k: string, v: string) => Promise<void>;
    send?: (failures: Array<{ label: string; error: string }>) => Promise<void>;
  } = {},
): Promise<string[]> {
  const get = deps.get ?? getSetting;
  const set = deps.set ?? setSetting;
  const failures: Array<{ site: string; label: string; error: string }> = [];
  for (const s of report.sites) {
    if (s.status !== "failed") continue;
    if (!(await get(`${LAST_POST_PREFIX}${s.site}`))) continue;
    const key = `${SLOT_PREFIX}alerted:${s.site}`;
    if ((await get(key)) === report.etDay) continue;
    failures.push({ site: s.site, label: s.label, error: s.posts.find((p) => p.error)?.error ?? s.reason ?? "unknown error" });
  }
  if (failures.length === 0) return [];
  if (deps.send) await deps.send(failures);
  else {
    const { isMailConfigured, sendSocialFailureEmail } = await import("@/lib/server/mail");
    const { OWNER_EMAIL } = await import("@/lib/server/users");
    if (!isMailConfigured()) return [];
    await sendSocialFailureEmail(OWNER_EMAIL, failures);
  }
  for (const f of failures) await set(`${SLOT_PREFIX}alerted:${f.site}`, report.etDay);
  return failures.map((f) => f.site);
}

/** One Completed line per run that posted or failed; silent when nothing happened. */
export async function noteOnBoard(report: PublishReport, now = Date.now()): Promise<void> {
  const active = report.sites.filter((s) => s.status === "posted" || (s.status === "failed" && !s.repeat));
  if (active.length === 0) return;
  const text = active
    .map((s) => {
      const ok = s.posts.filter((p) => p.uri);
      const bad = s.posts.filter((p) => p.error && !p.uri);
      const parts = [`${s.label}: ${ok.length ? ok.map((p) => `${p.title}${p.video === "yes" ? " (video)" : p.video === "fallback" ? " (picture, video failed)" : ""} → ${p.uri}`).join(", ") : "nothing went out"}`];
      if (bad.length) parts.push(`failed: ${bad.map((p) => `${p.title} (${p.error})`).join("; ")}`);
      return parts.join(" — ");
    })
    .join(" | ");
  await addCompletedLine(`Social autopilot ${report.etDay} ${report.slot ? slotLabel(report.slot, report.etDay) : ""} — ${text}`, now);
}

/** Put one done line at the top of the board's Completed section. Never throws: a board that will not save skips the note. */
export async function addCompletedLine(line: string, now = Date.now()): Promise<void> {
  // Two tries: loadBoard may normalize and re-save, moving the stamp under us.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { sections, updatedAt } = await loadBoard();
      let completed = sections.find(isCompletedSection);
      if (!completed) {
        completed = { id: randomUUID(), title: COMPLETED_TITLE, hint: "what got finished, newest first", items: [] };
        sections.push(completed);
      }
      completed.items.unshift({ id: randomUUID(), done: true, owner: "Claude", text: line, completedAt: now, from: "Claude — my queue (in order)" });
      await saveBoard(sections, updatedAt);
      return;
    } catch (err) {
      if (!(err instanceof BoardConflictError) || attempt === 1) {
        console.warn("social: board note skipped", err instanceof Error ? err.message : err);
        return;
      }
    }
  }
}

/** For /admin/social: which sites are connected and when each last posted. */
export async function siteStatus(sites: SocialSite[]): Promise<Array<{ site: string; label: string; connected: boolean; connectPath: string | null; lastDay: string | null; uris: string[] }>> {
  return Promise.all(
    sites.map(async (s) => {
      const lastDay = await getSetting(`${LAST_POST_PREFIX}${s.id}`);
      let uris: string[] = [];
      try {
        uris = JSON.parse((await getSetting(`${LAST_POST_PREFIX}${s.id}:uris`)) ?? "[]") as string[];
      } catch {
        /* older value */
      }
      const connected = s.connected() && (!s.authorized || (await s.authorized().catch(() => false)));
      // The connect link shows once the app keys are on Vercel and the account is not yet connected.
      const connectPath = s.connectPath && s.connected() && !connected ? s.connectPath : null;
      return { site: s.id, label: s.label, connected, connectPath, lastDay, uris };
    }),
  );
}
