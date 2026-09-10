import "server-only";
import { randomUUID } from "node:crypto";
import { getSetting, setSetting } from "@/lib/server/settings";
import { socialDrafts, POST_SIZES, type SocialPost } from "@/lib/server/social";
import { BoardConflictError, COMPLETED_TITLE, isCompletedSection, loadBoard, saveBoard } from "@/lib/server/board";
import { todayUtc } from "@/lib/priceSeries";
import type { GameId } from "@/lib/types";

/**
 * Social autopilot — the publisher (docs/SOCIAL-AUTOPILOT.md §1). Runs as
 * the last step of the daily Pokémon cron (Hobby plan = two crons, so it
 * rides along) and from GET/POST /api/social/publish?key=CRON_SECRET.
 *
 * Every connected site gets today's drafts as pictures, at most once per
 * day (settings key social_last_post:<site> = the day posted), only on
 * post days (Tue/Thu/Sat UTC, docs/SOCIAL.md cadence) unless forced. A
 * site is "connected" when its env vars exist — Chris pastes one token on
 * his board row, I put it on Vercel, nothing else. Each run leaves one
 * line on the board's Completed list so Chris sees what went out without
 * opening any social site.
 */
export const POST_WEEKDAYS = [2, 4, 6]; // Tue, Thu, Sat (UTC)
export const LAST_POST_PREFIX = "social_last_post:";
export const GAMES: GameId[] = ["pokemon", "mtg"];

export interface SitePost {
  text: string;
  image: Buffer;
  mime: string;
  width: number;
  height: number;
  alt: string;
}

export interface SocialSite {
  id: string;
  label: string;
  /** Post length the site allows; captions are fitted to it. */
  maxChars: number;
  maxImageBytes: number;
  connected(): boolean;
  post(p: SitePost): Promise<{ uri: string }>;
}

export interface SiteReport {
  site: string;
  label: string;
  status: "posted" | "skipped" | "dry" | "failed";
  reason?: string;
  posts: Array<{ id: string; title: string; uri?: string; error?: string }>;
}

export interface PublishReport {
  day: string;
  postDay: boolean;
  forced: boolean;
  drafts: number;
  sites: SiteReport[];
}

export function isPostDay(day: string): boolean {
  return POST_WEEKDAYS.includes(new Date(`${day}T00:00:00Z`).getUTCDay());
}

/** Caption + hashtags, shortened until it fits the site's limit. */
export function fitText(post: SocialPost, maxChars: number): string {
  const tags = post.hashtags.map((h) => `#${h}`).join(" ");
  const full = `${post.caption}\n\n${tags}`;
  if (full.length <= maxChars) return full;
  if (post.caption.length <= maxChars) return post.caption;
  const short = post.shortCaption ?? post.caption;
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
  force?: boolean;
  /** Report what would go out; touch nothing. */
  dry?: boolean;
  /** Where to fetch the pictures from (this deployment's own origin). */
  origin: string;
  sites: SocialSite[];
  fetchImage?: (url: string) => Promise<Buffer>;
  now?: number;
}

async function defaultFetchImage(url: string): Promise<Buffer> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`image ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function publishSocial(opts: PublishOptions): Promise<PublishReport> {
  const day = opts.day ?? todayUtc();
  const force = Boolean(opts.force);
  const postDay = isPostDay(day);
  const report: PublishReport = { day, postDay, forced: force, drafts: 0, sites: [] };
  const connected = opts.sites.filter((s) => s.connected());
  for (const s of opts.sites) {
    if (!connected.includes(s)) report.sites.push({ site: s.id, label: s.label, status: "skipped", reason: "not connected", posts: [] });
  }
  if (connected.length === 0) return report;
  if (!postDay && !force) {
    for (const s of connected) report.sites.push({ site: s.id, label: s.label, status: "skipped", reason: "not a post day", posts: [] });
    return report;
  }
  const drafts = (await Promise.all(GAMES.map((g) => socialDrafts(g, day)))).flat();
  report.drafts = drafts.length;
  if (drafts.length === 0) {
    for (const s of connected) report.sites.push({ site: s.id, label: s.label, status: "skipped", reason: "nothing to post", posts: [] });
    return report;
  }
  const fetchImage = opts.fetchImage ?? defaultFetchImage;
  const key = process.env.CRON_SECRET ?? "";
  const images = new Map<string, Buffer>();
  async function pngFor(d: SocialPost): Promise<Buffer> {
    const hit = images.get(d.id);
    if (hit) return hit;
    const bytes = await fetchImage(`${opts.origin}${d.imagePath}&size=square&key=${encodeURIComponent(key)}`);
    images.set(d.id, bytes);
    return bytes;
  }

  for (const site of connected) {
    const last = await getSetting(`${LAST_POST_PREFIX}${site.id}`);
    if (last === day && !force) {
      report.sites.push({ site: site.id, label: site.label, status: "skipped", reason: "already posted today", posts: [] });
      continue;
    }
    const entry: SiteReport = { site: site.id, label: site.label, status: opts.dry ? "dry" : "posted", posts: [] };
    for (const d of drafts) {
      const text = fitText(d, site.maxChars);
      if (opts.dry) {
        entry.posts.push({ id: d.id, title: d.title });
        continue;
      }
      try {
        const png = await pngFor(d);
        const img = await fitImage(png, site.maxImageBytes);
        const { uri } = await site.post({
          text,
          image: img.bytes,
          mime: img.mime,
          width: POST_SIZES.square.width,
          height: POST_SIZES.square.height,
          alt: `${d.title}. ${d.caption.split("\n")[0]}`,
        });
        entry.posts.push({ id: d.id, title: d.title, uri });
      } catch (err) {
        entry.posts.push({ id: d.id, title: d.title, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (!opts.dry) {
      const posted = entry.posts.filter((p) => p.uri);
      if (posted.length === 0) entry.status = "failed";
      else {
        await setSetting(`${LAST_POST_PREFIX}${site.id}`, day);
        await setSetting(`${LAST_POST_PREFIX}${site.id}:uris`, JSON.stringify(posted.map((p) => p.uri)));
      }
    }
    report.sites.push(entry);
  }
  if (!opts.dry) await noteOnBoard(report, opts.now ?? Date.now());
  return report;
}

/** One Completed line per run that posted or failed; silent when nothing happened. */
export async function noteOnBoard(report: PublishReport, now = Date.now()): Promise<void> {
  const active = report.sites.filter((s) => s.status === "posted" || s.status === "failed");
  if (active.length === 0) return;
  const text = active
    .map((s) => {
      const ok = s.posts.filter((p) => p.uri);
      const bad = s.posts.filter((p) => p.error);
      const parts = [`${s.label}: ${ok.length ? ok.map((p) => `${p.title} → ${p.uri}`).join(", ") : "nothing went out"}`];
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
      completed.items.unshift({ id: randomUUID(), done: true, owner: "Claude", text: `Social autopilot ${report.day} — ${text}`, completedAt: now, from: "Claude — my queue (in order)" });
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
export async function siteStatus(sites: SocialSite[]): Promise<Array<{ site: string; label: string; connected: boolean; lastDay: string | null; uris: string[] }>> {
  return Promise.all(
    sites.map(async (s) => {
      const lastDay = await getSetting(`${LAST_POST_PREFIX}${s.id}`);
      let uris: string[] = [];
      try {
        uris = JSON.parse((await getSetting(`${LAST_POST_PREFIX}${s.id}:uris`)) ?? "[]") as string[];
      } catch {
        /* older value */
      }
      return { site: s.id, label: s.label, connected: s.connected(), lastDay, uris };
    }),
  );
}
