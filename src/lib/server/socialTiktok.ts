import "server-only";
import { addDays } from "@/lib/priceSeries";
import { GENERAL_TAGS, MAX_TAGS } from "@/lib/socialPlan";
import { etDate } from "@/lib/time";
import { getSetting, setSetting } from "@/lib/server/settings";
import { ensureSchedule } from "@/lib/server/socialSchedule";
import { TIKTOK_MAX_CHARS } from "@/lib/server/sites/tiktok";
import type { PostKind, SocialPost } from "@/lib/server/social";
import {
  applyGameLeads,
  applyVideoCards,
  eastern,
  FALLBACK_KINDS,
  fitText,
  planTag,
  SLOTS,
  slotKind,
  slotTimeLabel,
  videoFor,
  type Slot,
} from "@/lib/server/socialPublish";
import {
  TIKTOK_ALERTED_KEY,
  TIKTOK_DISPATCH_PREFIX,
  TIKTOK_MAILED_PREFIX,
  TIKTOK_SLOTS,
  parseTiktokSpec,
  tiktokKey,
  tiktokPostedKey,
  type PackageDay,
  type PackageRow,
  type PackageState,
  type TiktokSpec,
} from "@/lib/socialTiktok";
import { videoKey, type LeadCard, type VideoCard, type VideoSpec } from "@/lib/socialVideo";
import type { GameId } from "@/lib/types";

/**
 * TikTok by hand, the server half (lib/socialTiktok.ts has the story): the
 * night render registers tomorrow's three videos, /admin/social reads them,
 * a safety net remakes anything missing or made under a plan that has since
 * changed, and one mail tells Chris the package is ready.
 */

/** Every draft the videos are made for is a Pokémon-keyed one (the games post is Pokémon-keyed too; socialPublish.ts GAMES). */
export const TIKTOK_GAME: GameId = "pokemon";
/** The kinds the video renderer can draw (a "card" of the day has no slot and no draft). */
export const VIDEO_KINDS: PostKind[] = ["set", "movers", "dips", "games"];
/** A dispatched render gets this long before the safety net calls it lost. */
export const DISPATCH_GAP_MS = 45 * 60_000;
/** A dispatch older than this is history (a render takes well under an hour): a later problem is a new one, not "still missing". */
export const DISPATCH_STALE_MS = 6 * 3_600_000;
/** The night render is expected done by this Eastern time (the card says so while it is not). */
export const READY_BY = "9:30pm ET";

/** The Eastern day after `now`'s Eastern day, by calendar arithmetic (never UTC's, which is already tomorrow at 8pm ET). */
export function tomorrowEastern(now = Date.now()): string {
  return addDays(eastern(now).day, 1);
}

/**
 * The day the night render builds for when it runs at `now`: tomorrow's
 * Eastern day, except in the small hours (before 7am ET) where a ping that
 * GitHub ran past midnight still means the day that is now today. Never a
 * UTC date: 8pm EDT is already 00:00 UTC of the next day, and the EDT→EST
 * switch (Nov 1) moves the 8pm ping an hour in UTC.
 */
export function tiktokTargetDay(now = Date.now()): string {
  const { day, hour } = eastern(now);
  return hour < 7 ? day : addDays(day, 1);
}

// planTag (the plan a slot's video was made under) lives in the publisher, which needs it to ignore a video whose plan has changed.
export { planTag };

/**
 * The kind a slot's video shows: the slot's own, or the first of the
 * publisher's fallbacks that has a draft (never skip a slot), restricted to
 * kinds the renderer can draw.
 */
export function pickVideoKind(slot: Slot, day: string, drafts: Pick<SocialPost, "kind">[], used: PostKind[] = []): PostKind | null {
  return candidateKinds(slot, day, drafts, used)[0] ?? null;
}

/**
 * Every kind the slot's video may show, best first: the render tries the next
 * when one cannot be drawn (a card with no art). `used` = the kinds the
 * package's other videos already show or are about to (registered rows, videos
 * drawn earlier in this run, the other slots' own kinds); they go last, so a
 * slot that falls back never repeats another slot's video (09-30 review: 7am
 * with no set draft became the all-games video, and so did 7pm). The 1pm video
 * keeps its own kind first whatever: it is the file every site posts.
 */
export function candidateKinds(slot: Slot, day: string, drafts: Pick<SocialPost, "kind">[], used: PostKind[] = []): PostKind[] {
  const own = slotKind(slot, day);
  const all = [own, ...FALLBACK_KINDS.filter((k) => k !== own)].filter((kind) => VIDEO_KINDS.includes(kind) && drafts.some((d) => d.kind === kind));
  const pinned = slot === "midday" ? all.filter((k) => k === own) : [];
  const rest = all.filter((k) => !pinned.includes(k));
  return [...pinned, ...rest.filter((k) => !used.includes(k)), ...rest.filter((k) => used.includes(k))];
}

/**
 * The TikTok text for a draft, built the way the publisher builds it for a
 * site (fitText to the site's limit, hashtags kept) and from the EXACT data
 * the video drew, so the caption always names what is on screen.
 */
export function tiktokPost(d: SocialPost, data: { cards?: VideoCard[]; leads?: LeadCard[] }): { title: string; caption: string } {
  const applied = data.cards?.length ? applyVideoCards(d, data.cards) : data.leads?.length ? applyGameLeads(d, data.leads) : d;
  // The all-games caption is written for the picture ("In the picture, one card …"); on TikTok it is a video. Only the TikTok copy changes.
  return { title: applied.title, caption: fitText({ ...applied, hashtags: tiktokTags(applied.hashtags) }, TIKTOK_MAX_CHARS, MAX_TAGS).replace(/^In the picture,/m, "In the video,") };
}

/**
 * TikTok shows five hashtags and more reads as spam (10-01): the post's own,
 * game tags first, then the general ones (#TCG #TradingCards #CardCollector)
 * for whatever room is left, never past MAX_TAGS.
 */
export function tiktokTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of [...tags, ...GENERAL_TAGS]) if (!out.includes(t)) out.push(t);
  return out.slice(0, MAX_TAGS);
}

/** The movers row the other sites post at 1:05pm (settings social_video:pokemon:movers:<day>), if the render has made it. Raw: made under any plan. */
export async function sharedMovers(day: string): Promise<VideoSpec | null> {
  return videoFor({ game: TIKTOK_GAME, kind: SLOTS.midday.kind, day });
}

/**
 * The 1pm movers video as the sites will find it: present and made under the
 * plan in force now (ready), present but made under one that has since changed
 * (stale: a plan pushed after the night render must not be answered by "it
 * exists", or the 10:30 pings and the 12:40 net both leave the old video to go
 * out at 1:05pm, 09-30 review), or not there (missing).
 */
export async function middayVideo(day: string): Promise<{ spec: VideoSpec | null; state: PackageState }> {
  const spec = await sharedMovers(day);
  if (!spec) return { spec: null, state: "missing" };
  return { spec, state: spec.plan && spec.plan !== planTag("midday", day) ? "stale" : "ready" };
}

interface SlotRead {
  state: PackageState;
  spec: TiktokSpec | null;
}

/** One slot's registration and whether it can be handed over: present, made under today's plan, and (1pm) still the file the other sites post. */
export async function readSlot(slot: Slot, day: string): Promise<SlotRead> {
  await ensureSchedule();
  const spec = parseTiktokSpec(await getSetting(tiktokKey(slot, day)));
  if (!spec) return { state: "missing", spec: null };
  if (spec.plan !== planTag(slot, day)) return { state: "stale", spec };
  if (slot === "midday" && spec.kind === SLOTS.midday.kind) {
    const shared = await sharedMovers(day);
    if (!shared || shared.url !== spec.url) return { state: "stale", spec };
  }
  return { state: "ready", spec };
}

/** Slots with nothing usable registered for the day: missing, or made under a plan that changed. */
export async function slotsToRender(day: string): Promise<Slot[]> {
  const out: Slot[] = [];
  for (const slot of TIKTOK_SLOTS) if ((await readSlot(slot, day)).state !== "ready") out.push(slot);
  return out;
}

/** What to tell Chris about a row that is not ready yet. */
export function readyNote(slot: Slot, day: string, state: PackageState, now = Date.now()): string {
  const { day: today, hour } = eastern(now);
  const remade = state === "stale" ? "Made for an older plan. " : "";
  if (day > today) return `${remade}${hour >= 22 ? "Not ready yet. The safety net retries soon." : `Ready by about ${READY_BY} tonight.`}`;
  if (day < today) return "Not made.";
  if (slot === "midday") return `${remade}${hour < 11 ? "Renders around 10:30am ET." : hour < 13 ? "Rendering now. Check back in a few minutes." : "Not made."}`;
  // 7am and 7pm: the 5:45am check remakes either before the day starts, the 12:40pm one a 7pm video that is still to post.
  if (hour < 6) return `${remade}The morning check remakes it around 6am ET.`;
  return `${remade}${hour < 13 && SLOTS[slot].hour > hour ? "The midday check remakes it around 12:40pm ET." : "Not made."}`;
}

/** The hand-over card's rows for one Eastern day (plain data, safe for the client). */
export async function loadPackage(day: string, now = Date.now()): Promise<PackageDay> {
  const rows: PackageRow[] = [];
  for (const slot of TIKTOK_SLOTS) {
    const { state, spec } = await readSlot(slot, day);
    const posted = (await getSetting(tiktokPostedKey(slot, day))) === "1";
    const ready = state === "ready" && spec;
    rows.push({
      slot,
      time: `${slotTimeLabel(slot)} ET`,
      state,
      posted,
      title: ready ? spec.title : null,
      caption: ready ? spec.caption : null,
      url: ready ? spec.url : null,
      seconds: ready ? spec.seconds : 0,
      bytes: ready ? spec.bytes : 0,
      note: ready ? null : readyNote(slot, day, state, now),
    });
  }
  return { day, label: etDate(new Date(`${day}T12:00:00Z`), "—", { weekday: "short", month: "short", day: "numeric" }), rows };
}

/** True when every slot of the package can be handed over. */
export function packageReady(pkg: PackageDay): boolean {
  return pkg.rows.every((r) => r.state === "ready");
}

/** Mark Posted / Undo: social_slot:tiktok:<slot>:<day> = "1", "" to clear. Each day has its own key, so marking tomorrow's never touches today's. */
export async function markTiktokPosted(slot: Slot, day: string, posted: boolean): Promise<void> {
  await setSetting(tiktokPostedKey(slot, day), posted ? "1" : "");
}

export interface RegisterInput {
  slot: Slot;
  day: string;
  /** The kind the video shows. */
  kind: PostKind;
  url: string;
  bytes: number;
  seconds: number;
  width?: number;
  height?: number;
  /** The draft of that kind for the day (socialDrafts); the caption is built from it and the frozen data. */
  draft: SocialPost;
  cards?: VideoCard[];
  leads?: LeadCard[];
  audio?: string;
  now?: number;
}

/**
 * Register one rendered video for a slot and day. The TikTok row is always
 * written. The 1pm movers video is ALSO the row every other site posts at
 * 1:05pm (social_video:pokemon:movers:<day>); the 7am and 7pm videos are not,
 * so the six sites keep posting those pictures live. Returns the URLs of
 * files this replaced, for the caller to delete from Blob.
 */
export async function registerTiktokVideo(i: RegisterInput): Promise<{ spec: TiktokSpec; shared: VideoSpec | null; replaced: string[] }> {
  await ensureSchedule();
  const plan = planTag(i.slot, i.day);
  const post = tiktokPost(i.draft, { cards: i.cards, leads: i.leads });
  const base: VideoSpec = {
    url: i.url,
    bytes: i.bytes,
    mime: "video/mp4",
    width: i.width ?? 1080,
    height: i.height ?? 1920,
    seconds: i.seconds,
    renderedAt: i.now ?? Date.now(),
    kind: i.kind,
    cards: i.cards,
    leads: i.leads,
    plan,
  };
  const spec: TiktokSpec = { ...base, slot: i.slot, day: i.day, title: post.title, caption: post.caption, plan, kind: i.kind, audio: i.audio };
  const before = [parseTiktokSpec(await getSetting(tiktokKey(i.slot, i.day)))?.url];
  await setSetting(tiktokKey(i.slot, i.day), JSON.stringify(spec));
  let shared: VideoSpec | null = null;
  if (i.slot === "midday" && i.kind === SLOTS.midday.kind) {
    shared = { ...base, cards: i.cards, leads: undefined };
    before.push((await sharedMovers(i.day))?.url);
    await setSetting(videoKey(TIKTOK_GAME, i.kind, i.day), JSON.stringify(shared));
  } else if (i.slot === "midday") {
    // A remake that fell back to another kind (the movers art was missing): the file the sites post is still
    // the earlier movers one, and the row the TikTok slot replaced may BE that file. Deleting it left the sites'
    // row pointing at a 404 (09-30 review). Keep it while the row is current; a row made under a plan that has
    // since changed is no use to anyone, so that one goes (its picture posts instead, the net remakes it).
    const old = await sharedMovers(i.day);
    if (old) {
      const stale = Boolean(old.plan) && old.plan !== planTag("midday", i.day);
      if (stale) {
        await setSetting(videoKey(TIKTOK_GAME, SLOTS.midday.kind, i.day), "");
        before.push(old.url);
      } else for (let k = before.length - 1; k >= 0; k--) if (before[k] === old.url) before.splice(k, 1);
    }
  }
  return { spec, shared, replaced: [...new Set(before.filter((u): u is string => Boolean(u) && u !== i.url))] };
}

/* ---------- the "ready" mail and the failure alert ---------- */

export interface ReadyMail {
  day: string;
  label: string;
  rows: Array<{ time: string; title: string; caption: string }>;
}

interface MailDeps {
  get?: (k: string) => Promise<string | null>;
  set?: (k: string, v: string) => Promise<void>;
}

/**
 * Mail the owner ONCE per target day, when all three videos can be handed
 * over ("Tomorrow's TikTok Videos Are Ready": the post times, each caption,
 * a link to /admin/social). The flag is claimed before the mail is sent, so
 * two pings racing cannot double-send, and is released if the send fails.
 * Sent by the owner-mail helper only (mail.ts), to the owner and nobody else.
 */
export async function notifyPackageReady(
  day: string,
  deps: MailDeps & { pkg?: PackageDay; send?: (m: ReadyMail) => Promise<void>; now?: number } = {},
): Promise<"sent" | "already" | "not-ready" | "no-mail" | "not-tomorrow"> {
  const get = deps.get ?? getSetting;
  const set = deps.set ?? setSetting;
  const pkg = deps.pkg ?? (await loadPackage(day));
  if (!packageReady(pkg)) return "not-ready";
  // The render that made these is done: forget its dispatch, or a plan pushed hours later finds it and cries "still missing after a render was started".
  await set(`${TIKTOK_DISPATCH_PREFIX}${day}`, "");
  // The mail says "Tomorrow's": a package for today (a same-day remake finishing) is not news.
  if (day <= eastern(deps.now).day) return "not-tomorrow";
  const key = `${TIKTOK_MAILED_PREFIX}${day}`;
  if ((await get(key)) === "1") return "already";
  const mail: ReadyMail = { day, label: pkg.label, rows: pkg.rows.map((r) => ({ time: r.time, title: r.title ?? "", caption: r.caption ?? "" })) };
  if (!deps.send) {
    const { isMailConfigured } = await import("@/lib/server/mail");
    if (!isMailConfigured()) return "no-mail";
  }
  await set(key, "1");
  try {
    if (deps.send) await deps.send(mail);
    else {
      const { sendTiktokReadyEmail } = await import("@/lib/server/mail");
      const { OWNER_EMAIL } = await import("@/lib/server/users");
      await sendTiktokReadyEmail(OWNER_EMAIL, mail);
    }
  } catch (err) {
    await set(key, "");
    throw err;
  }
  return "sent";
}

/**
 * A failed nightly render goes through the existing failure alert path
 * (mail.ts sendSocialFailureEmail, the same one alertFailures uses): one mail
 * per target day, keyed like the publisher's social_slot:alerted:<site>.
 */
export async function alertPackageFailure(
  day: string,
  error: string,
  deps: MailDeps & { send?: (failures: Array<{ label: string; error: string }>) => Promise<void> } = {},
): Promise<boolean> {
  const get = deps.get ?? getSetting;
  const set = deps.set ?? setSetting;
  if ((await get(TIKTOK_ALERTED_KEY)) === day) return false;
  const failures = [{ label: "TikTok Videos", error: `${day}: ${error}` }];
  if (deps.send) await deps.send(failures);
  else {
    const { isMailConfigured, sendSocialFailureEmail } = await import("@/lib/server/mail");
    const { OWNER_EMAIL } = await import("@/lib/server/users");
    if (!isMailConfigured()) return false;
    await sendSocialFailureEmail(OWNER_EMAIL, failures, { intro: `The night render could not build the TikTok videos for ${day}.`, subject: "CardFlip: TikTok Videos Not Built" });
  }
  await set(TIKTOK_ALERTED_KEY, day);
  return true;
}

/* ---------- the safety net (Vercel cron → /api/cron/social-tiktok) ---------- */

/**
 * Dispatch the workflow's render-only TikTok run for one target day (GitHub
 * token, same as /api/cron/social-video). `slots` limits it to the slots the
 * caller found missing (the job skips ready ones anyway; this keeps it off a
 * slot another run is already remaking).
 */
export async function dispatchTiktokRender(day: string, slots?: Slot[]): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not configured");
  const { BOARD_REPO, ghHeaders } = await import("@/lib/server/boardRuns");
  const res = await fetch(`https://api.github.com/repos/${BOARD_REPO}/actions/workflows/social-post.yml/dispatches`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main", inputs: { tiktok: "1", tiktok_day: day, ...(slots?.length ? { tiktok_slots: slots.join(",") } : {}) } }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (res.status !== 204) throw new Error(`GitHub ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
}

export interface NetReport {
  /** The Eastern day whose package was checked, null outside the check windows. */
  day: string | null;
  action: "outside-window" | "ready" | "waiting" | "dispatched" | "dispatch-failed";
  need: Slot[];
  mailed?: string;
  alerted?: boolean;
  error?: string;
}

/**
 * The safety net. Three windows a day, all Eastern:
 *  - 9pm on: TOMORROW's package. All three ready → mail once. Anything
 *    missing or made under a plan that has since changed → dispatch a
 *    render-only run (the job remakes only those slots).
 *  - before 7am: TODAY's package, for a plan pushed after last night's
 *    check (a wrong 7am video must not wait for tonight).
 *  - `sameDay` (the 12:40pm check, /api/cron/social-video): TODAY's videos
 *    still to be posted, for a plan pushed after 7am. Without it a 9am push
 *    left the 7pm video stale for good (the 9:15pm check looks at tomorrow).
 *    `skip` = slots the caller is already remaking.
 * A dispatch is given DISPATCH_GAP_MS; a package still incomplete after a
 * dispatch that old (but younger than DISPATCH_STALE_MS) sends the failure
 * alert (once a day) and tries again.
 */
export async function packageSafetyNet(
  opts: { now?: number; force?: boolean; dry?: boolean; day?: string; sameDay?: boolean; skip?: Slot[] } = {},
  deps: {
    dispatch?: (day: string, slots: Slot[]) => Promise<void>;
    notify?: (day: string) => Promise<string>;
    alert?: (day: string, error: string) => Promise<boolean>;
  } = {},
): Promise<NetReport> {
  const now = opts.now ?? Date.now();
  const { day: today, hour } = eastern(now);
  const target = opts.day ?? (opts.sameDay ? today : hour < 7 || hour >= 21 || opts.force ? tiktokTargetDay(now) : null);
  if (!target) return { day: null, action: "outside-window", need: [] };
  const pending = await slotsToRender(target);
  // Today's package: a video whose post time has passed is not worth a render, and one the caller is remaking is its business.
  const need = pending.filter((slot) => (target !== today || SLOTS[slot].hour > hour) && !opts.skip?.includes(slot));
  const key = `${TIKTOK_DISPATCH_PREFIX}${target}`;
  if (need.length === 0) {
    const mailed = target > today ? await (deps.notify ?? ((d: string) => notifyPackageReady(d)))(target) : undefined;
    // Done: forget the dispatch, so a plan that changes later starts a fresh render, not a false "still missing".
    if (!opts.dry && pending.length === 0) await setSetting(key, "");
    return { day: target, action: "ready", need, ...(mailed ? { mailed } : {}) };
  }
  if (opts.dry) return { day: target, action: "waiting", need };
  let prev: { at: number; n: number } | null = null;
  try {
    prev = JSON.parse((await getSetting(key)) ?? "null");
  } catch {
    prev = null;
  }
  if (prev && now - prev.at < DISPATCH_GAP_MS && !opts.force) return { day: target, action: "waiting", need };
  // A dispatch from hours ago belongs to an earlier episode (last night's render, done since): it is not a render that failed to fix THIS.
  if (prev && now - prev.at >= DISPATCH_STALE_MS) prev = null;
  const alert = deps.alert ?? ((d: string, e: string) => alertPackageFailure(d, e));
  let alerted = false;
  // Dispatched before, long enough ago to have finished, and still incomplete: the render is failing.
  if (prev) alerted = await alert(target, `Still missing after a render was started (${need.join(", ")}).`).catch(() => false);
  try {
    await (deps.dispatch ?? dispatchTiktokRender)(target, need);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    alerted = (await alert(target, `Could not start the render: ${error}`).catch(() => false)) || alerted;
    return { day: target, action: "dispatch-failed", need, alerted, error };
  }
  await setSetting(key, JSON.stringify({ at: now, n: (prev?.n ?? 0) + 1 }));
  return { day: target, action: "dispatched", need, alerted };
}
