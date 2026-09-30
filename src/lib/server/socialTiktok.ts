import "server-only";
import { addDays } from "@/lib/priceSeries";
import { dayPlan } from "@/lib/socialPlan";
import { etDate } from "@/lib/time";
import { getSetting, setSetting } from "@/lib/server/settings";
import { TIKTOK_MAX_CHARS } from "@/lib/server/sites/tiktok";
import type { PostKind, SocialPost } from "@/lib/server/social";
import {
  applyGameLeads,
  applyVideoCards,
  eastern,
  FALLBACK_KINDS,
  fitText,
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

/**
 * The plan a slot's video was made under: its kind plus the day-plan flags
 * that change what the video or its caption says. Stored on the row; a
 * row whose tag differs from the current one is stale and gets remade.
 */
export function planTag(slot: Slot, day: string): string {
  const p = dayPlan(day);
  const kind = slotKind(slot, day);
  return [kind, kind === "movers" && p.mixedMovers ? "mixed" : "", kind !== "games" && p.alsoScans ? "also" : "", kind === "set" && p.set ? `set=${p.set}` : ""].filter(Boolean).join("+");
}

/**
 * The kind a slot's video shows: the slot's own, or the first of the
 * publisher's fallbacks that has a draft (never skip a slot), restricted to
 * kinds the renderer can draw.
 */
export function pickVideoKind(slot: Slot, day: string, drafts: Pick<SocialPost, "kind">[]): PostKind | null {
  return candidateKinds(slot, day, drafts)[0] ?? null;
}

/** Every kind the slot's video may show, best first: the render tries the next when one cannot be drawn (a card with no art). */
export function candidateKinds(slot: Slot, day: string, drafts: Pick<SocialPost, "kind">[]): PostKind[] {
  const own = slotKind(slot, day);
  return [own, ...FALLBACK_KINDS.filter((k) => k !== own)].filter((kind) => VIDEO_KINDS.includes(kind) && drafts.some((d) => d.kind === kind));
}

/**
 * The TikTok text for a draft, built the way the publisher builds it for a
 * site (fitText to the site's limit, hashtags kept) and from the EXACT data
 * the video drew, so the caption always names what is on screen.
 */
export function tiktokPost(d: SocialPost, data: { cards?: VideoCard[]; leads?: LeadCard[] }): { title: string; caption: string } {
  const applied = data.cards?.length ? applyVideoCards(d, data.cards) : data.leads?.length ? applyGameLeads(d, data.leads) : d;
  // The all-games caption is written for the picture ("In the picture, one card …"); on TikTok it is a video. Only the TikTok copy changes.
  return { title: applied.title, caption: fitText(applied, TIKTOK_MAX_CHARS).replace(/^In the picture,/m, "In the video,") };
}

/** The movers row the other sites post at 1:05pm (settings social_video:pokemon:movers:<day>), if the render has made it. */
export async function sharedMovers(day: string): Promise<VideoSpec | null> {
  return videoFor({ game: TIKTOK_GAME, kind: SLOTS.midday.kind, day });
}

interface SlotRead {
  state: PackageState;
  spec: TiktokSpec | null;
}

/** One slot's registration and whether it can be handed over: present, made under today's plan, and (1pm) still the file the other sites post. */
export async function readSlot(slot: Slot, day: string): Promise<SlotRead> {
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
  return `${remade}${hour < 6 ? "The morning check remakes it around 6am ET." : "Not made."}`;
}

/** The hand-over card's rows for one Eastern day (plain data, safe for the client). */
export async function loadPackage(day: string, now = Date.now()): Promise<PackageDay> {
  const rows: PackageRow[] = [];
  for (const slot of TIKTOK_SLOTS) {
    const { state, spec } = await readSlot(slot, day);
    const posted = (await getSetting(tiktokPostedKey(slot))) === day;
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

/** Mark Posted / Undo: social_slot:tiktok:<slot> = the Eastern day (the publisher's key shape), "" to clear. */
export async function markTiktokPosted(slot: Slot, day: string, posted: boolean): Promise<void> {
  await setSetting(tiktokPostedKey(slot), posted ? day : "");
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
  deps: MailDeps & { pkg?: PackageDay; send?: (m: ReadyMail) => Promise<void> } = {},
): Promise<"sent" | "already" | "not-ready" | "no-mail"> {
  const get = deps.get ?? getSetting;
  const set = deps.set ?? setSetting;
  const pkg = deps.pkg ?? (await loadPackage(day));
  if (!packageReady(pkg)) return "not-ready";
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

/** Dispatch the workflow's render-only TikTok run for one target day (GitHub token, same as /api/cron/social-video). */
export async function dispatchTiktokRender(day: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not configured");
  const { BOARD_REPO, ghHeaders } = await import("@/lib/server/boardRuns");
  const res = await fetch(`https://api.github.com/repos/${BOARD_REPO}/actions/workflows/social-post.yml/dispatches`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main", inputs: { tiktok: "1", tiktok_day: day } }),
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
 * The safety net. Two windows a day, both Eastern:
 *  - 9pm on: TOMORROW's package. All three ready → mail once. Anything
 *    missing or made under a plan that has since changed → dispatch a
 *    render-only run (the job remakes only those slots).
 *  - before 7am: TODAY's package, for a plan pushed after last night's
 *    check (a wrong 7am video must not wait for tonight).
 * A dispatch is given DISPATCH_GAP_MS; a package still incomplete after a
 * dispatch that old sends the failure alert (once a day) and tries again.
 */
export async function packageSafetyNet(
  opts: { now?: number; force?: boolean; dry?: boolean; day?: string } = {},
  deps: {
    dispatch?: (day: string) => Promise<void>;
    notify?: (day: string) => Promise<string>;
    alert?: (day: string, error: string) => Promise<boolean>;
  } = {},
): Promise<NetReport> {
  const now = opts.now ?? Date.now();
  const { day: today, hour } = eastern(now);
  const target = opts.day ?? (hour < 7 || hour >= 21 || opts.force ? tiktokTargetDay(now) : null);
  if (!target) return { day: null, action: "outside-window", need: [] };
  const need = await slotsToRender(target);
  const key = `${TIKTOK_DISPATCH_PREFIX}${target}`;
  if (need.length === 0) {
    const mailed = target > today ? await (deps.notify ?? ((d: string) => notifyPackageReady(d)))(target) : undefined;
    // Done: forget the dispatch, so a plan that changes later starts a fresh render, not a false "still missing".
    if (!opts.dry) await setSetting(key, "");
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
  const alert = deps.alert ?? ((d: string, e: string) => alertPackageFailure(d, e));
  let alerted = false;
  // Dispatched before, long enough ago to have finished, and still incomplete: the render is failing.
  if (prev) alerted = await alert(target, `Still missing after a render was started (${need.join(", ")}).`).catch(() => false);
  try {
    await (deps.dispatch ?? dispatchTiktokRender)(target);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    alerted = (await alert(target, `Could not start the render: ${error}`).catch(() => false)) || alerted;
    return { day: target, action: "dispatch-failed", need, alerted, error };
  }
  await setSetting(key, JSON.stringify({ at: now, n: (prev?.n ?? 0) + 1 }));
  return { day: target, action: "dispatched", need, alerted };
}
