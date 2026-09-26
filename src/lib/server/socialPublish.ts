import "server-only";
import { randomUUID } from "node:crypto";
import { GATED_GAMES, gamePublic, getSetting, setSetting, type GatedGame } from "@/lib/server/settings";
import { markFeatured, socialDrafts, POST_SIZES, type PostKind, type SocialPost } from "@/lib/server/social";
import { BoardConflictError, COMPLETED_TITLE, isCompletedSection, loadBoard, saveBoard } from "@/lib/server/board";
import { parseVideoSpec, videoKey, type VideoSpec } from "@/lib/socialVideo";
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
export const SLOTS: Record<Slot, { hour: number; kind: PostKind; label: string }> = {
  morning: { hour: 7, kind: "set", label: "7am set spotlight" },
  midday: { hour: 13, kind: "movers", label: "1pm movers of the week" },
  evening: { hour: 19, kind: "dips", label: "7pm price drops" },
};
export const SLOT_ORDER: Slot[] = ["morning", "midday", "evening"];
export const SLOT_PREFIX = "social_slot:";
export const ET_ZONE = "America/New_York";

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
}

export interface SocialSite {
  id: string;
  label: string;
  /** Post length the site allows; captions are fitted to it. */
  maxChars: number;
  maxImageBytes: number;
  /** True when post() knows what to do with p.video; the publisher only fetches the MP4 for these. */
  postsVideo?: boolean;
  /** True when the site has no picture post (TikTok): slots without a rendered MP4 are skipped, and a failed video upload is a failure, not a picture. */
  videoOnly?: boolean;
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

/** Caption + hashtags, shortened until it fits the site's limit. */
export function fitText(post: SocialPost, maxChars: number): string {
  const tags = post.hashtags.map((h) => `#${h}`).join(" ");
  const full = `${post.caption}\n\n${tags}`;
  if (full.length <= maxChars) return full;
  if (post.caption.length <= maxChars) return post.caption;
  const short = post.shortCaption ?? post.caption;
  const shortTagged = `${short}\n\n${tags}`;
  if (shortTagged.length <= maxChars) return shortTagged;
  if (short.length <= maxChars) return short;
  // Last resort: cut on a line boundary and keep the sign-off.
  const signOff = "cardflip.io";
  const lines = short.split("\n");
  let out = "";
  for (const line of lines) {
    if (`${out}${line}\n${signOff}`.length > maxChars) break;
    out += `${line}\n`;
  }
  return `${out}${signOff}`;
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
  fetchImage?: (url: string) => Promise<Buffer>;
  /** Fetches a registered MP4 from Blob (test hook). */
  fetchVideo?: (url: string) => Promise<Buffer>;
  now?: number;
}

async function defaultFetchImage(url: string): Promise<Buffer> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`image ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
async function defaultFetchVideo(url: string): Promise<Buffer> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(40_000) });
  if (!res.ok) throw new Error(`video ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** The MP4 registered for a draft by the render job, or null (picture post). */
export async function videoFor(d: Pick<SocialPost, "game" | "kind" | "day">): Promise<VideoSpec | null> {
  return parseVideoSpec(await getSetting(videoKey(d.game, d.kind, d.day)));
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
  const connected = await connectedSites(opts.sites);
  const slotKey = (site: SocialSite, slot: Slot) => `${SLOT_PREFIX}${site.id}:${slot}`;
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
  const all = (await Promise.all((await socialGames()).map((g) => socialDrafts(g, day)))).flat();
  const games = [...new Set(all.map((d) => d.game))];
  // One draft per game per slot, of that slot's kind only: repeating the
  // midday picture at 7pm is worse than staying quiet on a thin day.
  const plan = due
    .map((s) => ({ slot: s, drafts: games.map((g) => all.find((d) => d.game === g && d.kind === SLOTS[s].kind)).filter((d): d is SocialPost => Boolean(d)) }))
    .filter((p) => p.drafts.length > 0);
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
      p = fetchImage(`${opts.origin}${d.imagePath}&size=square&key=${encodeURIComponent(key)}`);
      images.set(d.id, p);
    }
    return p;
  }
  const videos = new Map<string, Promise<SitePostVideo | null>>();
  function videoOf(d: SocialPost): Promise<SitePostVideo | null> {
    let p = videos.get(d.id);
    if (!p) {
      p = (async () => {
        const spec = await videoFor(d);
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

  async function postOne(site: SocialSite, d: SocialPost, text: string): Promise<{ uri: string; video?: "yes" | "fallback"; error?: string }> {
    const png = await pngFor(d);
    const img = await fitImage(png, site.maxImageBytes);
    const base: SitePost = {
      text,
      image: img.bytes,
      mime: img.mime,
      width: POST_SIZES.square.width,
      height: POST_SIZES.square.height,
      alt: `${d.title}. ${d.caption.split("\n")[0]}`,
    };
    const video = site.postsVideo ? await videoOf(d) : null;
    if (!video) {
      if (site.videoOnly) throw new Error("no video rendered for this post");
      return site.post(base);
    }
    try {
      const { uri } = await site.post({ ...base, video });
      return { uri, video: "yes" };
    } catch (err) {
      // Video is the upgrade, the picture is the post: never lose the slot to a video upload.
      if (site.videoOnly) throw err;
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
    if (site.videoOnly) {
      // A video-only site owes nothing on a slot with no rendered MP4 (only the 7am set spotlight is rendered today).
      const withVideo: typeof plan = [];
      for (const p of todo) {
        const drafts: SocialPost[] = [];
        for (const d of p.drafts) if (await videoFor(d)) drafts.push(d);
        if (drafts.length) withVideo.push({ slot: p.slot, drafts });
      }
      todo = withVideo;
      if (todo.length === 0) return { site: site.id, label: site.label, status: "skipped", reason: "video only, nothing rendered for this slot", posts: [] };
    }
    const entry: SiteReport = { site: site.id, label: site.label, status: opts.dry ? "dry" : "posted", posts: [] };
    for (const p of todo) {
      let landed = 0;
      for (const d of p.drafts) {
        const text = fitText(d, site.maxChars);
        if (opts.dry) {
          entry.posts.push({ id: d.id, title: d.title, video: site.postsVideo && (await videoFor(d)) ? "yes" : undefined });
          continue;
        }
        try {
          const r = await postOne(site, d, text);
          entry.posts.push({ id: d.id, title: d.title, uri: r.uri, ...(r.video ? { video: r.video } : {}), ...(r.error ? { error: r.error } : {}) });
          landed++;
        } catch (err) {
          entry.posts.push({ id: d.id, title: d.title, error: err instanceof Error ? err.message : String(err) });
        }
      }
      if (!opts.dry && landed > 0) await setSetting(slotKey(site, p.slot), etDay);
    }
    if (!opts.dry) {
      const posted = entry.posts.filter((p) => p.uri);
      if (posted.length === 0) entry.status = "failed";
      else {
        await setSetting(`${LAST_POST_PREFIX}${site.id}`, etDay);
        await setSetting(`${LAST_POST_PREFIX}${site.id}:uris`, JSON.stringify(posted.map((p) => p.uri)));
      }
    }
    return entry;
  }

  // Every connected site at once; the report keeps the sites' order.
  report.sites.push(...(await Promise.all(connected.map(postSite))));
  if (!opts.dry) {
    // No-repeat rule: every gains/drops draft that landed anywhere keeps its cards out of that kind for FEATURED_DAYS.
    const landedIds = new Set(report.sites.flatMap((s) => s.posts.filter((p) => p.uri).map((p) => p.id)));
    for (const d of all) {
      if ((d.kind === "movers" || d.kind === "dips") && landedIds.has(d.id)) await markFeatured(d.game, d.kind, day, d.cardIds);
    }
    await noteOnBoard(report, now);
  }
  return report;
}

/** One Completed line per run that posted or failed; silent when nothing happened. */
export async function noteOnBoard(report: PublishReport, now = Date.now()): Promise<void> {
  const active = report.sites.filter((s) => s.status === "posted" || s.status === "failed");
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
  // Two tries: loadBoard may normalize and re-save, moving the stamp under us.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { sections, updatedAt } = await loadBoard();
      let completed = sections.find(isCompletedSection);
      if (!completed) {
        completed = { id: randomUUID(), title: COMPLETED_TITLE, hint: "what got finished, newest first", items: [] };
        sections.push(completed);
      }
      completed.items.unshift({ id: randomUUID(), done: true, owner: "Claude", text: `Social autopilot ${report.etDay} ${report.slot ? SLOTS[report.slot].label : ""} — ${text}`, completedAt: now, from: "Claude — my queue (in order)" });
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
