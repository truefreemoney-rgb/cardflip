import "server-only";
import { db } from "@/lib/db";
import { PLAN_NAME, PRICE, SCANS } from "@/lib/pricing";
import { digestTokenFor } from "@/lib/server/digest";
import { isMailConfigured, sendCampaignEmail } from "@/lib/server/mail";
import { getSetting, setSetting } from "@/lib/server/settings";
import { OWNER_EMAIL, listAllUsers, scanQuota, scanTier, type User } from "@/lib/server/users";

/**
 * Admin email campaigns (Chris, 10-07): about two mails a week to users who
 * haven't paid, on top of the Sunday digest (digest.ts). Each user gets the
 * one campaign that fits where they are:
 *
 *   scans_left    free trial, scans still left  -> "you still have N free scans"
 *   out_of_scans  free trial, all scans used    -> Booster / plan prices
 *
 * Subscribers, Booster holders, legacy, comped and admin accounts get none,
 * and neither does any account made before 10-07 (SIGNUP_CUTOFF, Chris).
 * The owner gets a [COPY] of each mail that went out in a run.
 * OFF by default (settings key email_campaigns_on, only "1" is on): Chris is
 * perfecting the copy first. Test sends from /admin/emails work while off.
 *
 * Runs inside the daily job on SEND_DAYS (Eastern). Caps, read from the
 * email_sends log: nothing within MIN_GAP_DAYS of the user's last campaign
 * mail, the same campaign at most once per SAME_GAP_DAYS, and at most
 * MAX_PER_CAMPAIGN of one campaign ever, so nobody is nagged forever.
 * The unsubscribe link reuses the digest token: digest_off stops both.
 */

export const CAMPAIGNS_ON_KEY = "email_campaigns_on";
export const CAMPAIGN_IDS = ["scans_left", "out_of_scans"] as const;
export type CampaignId = (typeof CAMPAIGN_IDS)[number];

export const CAMPAIGN_LABEL: Record<CampaignId, string> = {
  scans_left: "Free scans left",
  out_of_scans: "Out of free scans",
};

/** Eastern weekdays the sweep sends on. */
export const SEND_DAYS = ["Tue", "Fri"] as const;
export const MIN_GAP_DAYS = 3;
export const SAME_GAP_DAYS = 7;
export const MAX_PER_CAMPAIGN = 3;
/** A brand-new account gets the signup welcome, not a campaign. */
const MIN_AGE_MS = 24 * 3_600_000;
/** Chris 10-07: accounts made before 10-07 (Eastern midnight) never get campaign mail. The owner gets a copy of each mail that goes out instead. */
export const SIGNUP_CUTOFF = Date.parse("2026-10-07T04:00:00Z");
const USER_CAP = 500;
const DAY = 86_400_000;

export async function campaignsOn(): Promise<boolean> {
  return (await getSetting(CAMPAIGNS_ON_KEY)) === "1";
}

export async function setCampaignsOn(on: boolean): Promise<void> {
  await setSetting(CAMPAIGNS_ON_KEY, on ? "1" : "0");
}


/** The campaign this user fits right now, or null (paying, admin, Booster, legacy...). */
export function campaignFor(user: User): { id: CampaignId; scansLeft: number } | null {
  if (user.role === "admin") return null;
  if (scanTier(user) !== "trial") return null;
  const left = scanQuota(user).remaining ?? 0;
  return left > 0 ? { id: "scans_left", scansLeft: left } : { id: "out_of_scans", scansLeft: 0 };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const site = () => process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip.io";
const button = (href: string, label: string) =>
  `<p style="margin:20px 0"><a href="${href}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">${esc(label)}</a></p>`;

export interface RenderedCampaign {
  subject: string;
  text: string;
  html: string;
  unsubUrl: string;
}

/** The mail for one campaign. Prices and scan counts come only from lib/pricing.ts. */
export function renderCampaign(id: CampaignId, v: { firstName: string; scansLeft: number; unsubUrl: string }): RenderedCampaign {
  const first = v.firstName.replace(/[\r\n]+/g, " ").trim().split(/\s+/)[0] ?? "";
  const hi = first ? `Hi ${first},` : "Hi,";
  const footText = ["", `Stop these emails: ${v.unsubUrl}`, "", "— CardFlip · support@cardflip.io"];
  const footHtml = `<p style="color:#666;font-size:13px"><a href="${v.unsubUrl}" style="color:#666">Stop these emails</a>.</p>
    <p style="color:#999;font-size:12px">— CardFlip · support@cardflip.io</p>`;

  if (id === "scans_left") {
    const n = v.scansLeft;
    const scanUrl = `${site()}/app?scan=1`;
    const line1 = `You still have ${n} free scan${n === 1 ? "" : "s"} on CardFlip.`;
    const line2 = "Point your phone camera at any card. CardFlip names it, prices it, and drafts the eBay listing.";
    return {
      subject: `You still have ${n} free scan${n === 1 ? "" : "s"}`,
      text: [hi, "", line1, line2, "", `Start scanning: ${scanUrl}`, ...footText].join("\n"),
      html: `<p>${esc(hi)}</p><p>${esc(line1)}</p><p>${esc(line2)}</p>${button(scanUrl, "Start Scanning")}${footHtml}`,
      unsubUrl: v.unsubUrl,
    };
  }

  const pricingUrl = `${site()}/pricing`;
  const line1 = `You used all ${SCANS.trial} free scans. Want to keep scanning?`;
  const pack = `${PLAN_NAME.pack}: ${PRICE.pack} one time for ${SCANS.pack} scans. No subscription.`;
  const plan = `${PLAN_NAME.standard} plan: ${PRICE.standard} a month for ${SCANS.standard} scans.`;
  return {
    subject: "Your free scans are used up",
    text: [hi, "", line1, "", `· ${pack}`, `· ${plan}`, "", `Get more scans: ${pricingUrl}`, ...footText].join("\n"),
    html: `<p>${esc(hi)}</p><p>${esc(line1)}</p><ul style="margin:0;padding-left:18px"><li>${esc(pack)}</li><li>${esc(plan)}</li></ul>${button(pricingUrl, "Get More Scans")}${footHtml}`,
    unsubUrl: v.unsubUrl,
  };
}

function unsubUrlFor(userId: string, token: string): string {
  return `${site()}/api/digest/unsubscribe?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}&k=updates`;
}

async function logSend(row: { userId: string | null; email: string; campaign: string; status: "sent" | "failed" | "test" | "copy"; error?: string }, now = Date.now()): Promise<void> {
  await db
    .prepare("INSERT INTO email_sends (user_id, email, campaign, status, error, sent_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(row.userId, row.email, row.campaign, row.status, row.error ?? null, now);
}

interface SendRow {
  user_id: string;
  campaign: string;
  sent_at: number;
}

/** Real (non-test) sends per user, newest first. */
async function sendHistory(): Promise<Map<string, SendRow[]>> {
  const rows = (await db
    .prepare("SELECT user_id, campaign, sent_at FROM email_sends WHERE status = 'sent' AND user_id IS NOT NULL ORDER BY sent_at DESC")
    .all()) as unknown as SendRow[];
  const out = new Map<string, SendRow[]>();
  for (const r of rows) {
    const list = out.get(r.user_id) ?? [];
    list.push(r);
    out.set(r.user_id, list);
  }
  return out;
}

/** Why a user would be skipped by the caps, or null when a send is allowed. */
export function capBlocks(history: SendRow[] | undefined, id: CampaignId, now = Date.now()): string | null {
  if (!history?.length) return null;
  if (now - history[0].sent_at < MIN_GAP_DAYS * DAY) return "mailed recently";
  const same = history.filter((r) => r.campaign === id);
  if (same.length >= MAX_PER_CAMPAIGN) return "campaign limit reached";
  if (same.length && now - same[0].sent_at < SAME_GAP_DAYS * DAY) return "same mail this week";
  return null;
}

interface Candidate {
  user: User;
  id: CampaignId;
  scansLeft: number;
  blocked: string | null;
}

/** Everyone a campaign would reach, with the cap verdict for each. */
async function candidates(now = Date.now()): Promise<Candidate[]> {
  const offRows = (await db.prepare("SELECT id FROM users WHERE digest_off = 1 OR email_pending = 1").all()) as unknown as Array<{ id: string }>;
  const off = new Set(offRows.map((r) => r.id));
  const history = await sendHistory();
  const out: Candidate[] = [];
  for (const user of await listAllUsers()) {
    if (off.has(user.id) || user.createdAt < SIGNUP_CUTOFF || now - user.createdAt < MIN_AGE_MS) continue;
    const c = campaignFor(user);
    if (!c) continue;
    out.push({ user, id: c.id, scansLeft: c.scansLeft, blocked: capBlocks(history.get(user.id), c.id, now) });
  }
  return out;
}

export interface CampaignOverview {
  on: boolean;
  mailConfigured: boolean;
  sendDays: readonly string[];
  campaigns: Array<{ id: CampaignId; label: string; eligible: number; dueNext: number; sent: number; preview: RenderedCampaign }>;
  log: Array<{ email: string; campaign: string; status: string; error: string | null; sentAt: number }>;
}

/** Everything /admin/emails shows. */
export async function campaignOverview(now = Date.now()): Promise<CampaignOverview> {
  const list = await candidates(now);
  const sentRows = (await db
    .prepare("SELECT campaign, COUNT(*) AS n FROM email_sends WHERE status = 'sent' GROUP BY campaign")
    .all()) as unknown as Array<{ campaign: string; n: number }>;
  const sent = new Map(sentRows.map((r) => [r.campaign, Number(r.n)]));
  const sampleUnsub = `${site()}/api/digest/unsubscribe?u=preview&t=preview&k=updates`;
  const log = (await db
    .prepare("SELECT email, campaign, status, error, sent_at FROM email_sends ORDER BY sent_at DESC LIMIT 100")
    .all()) as unknown as Array<{ email: string; campaign: string; status: string; error: string | null; sent_at: number }>;
  return {
    on: await campaignsOn(),
    mailConfigured: isMailConfigured(),
    sendDays: SEND_DAYS,
    campaigns: CAMPAIGN_IDS.map((id) => ({
      id,
      label: CAMPAIGN_LABEL[id],
      eligible: list.filter((c) => c.id === id).length,
      dueNext: list.filter((c) => c.id === id && !c.blocked).length,
      sent: sent.get(id) ?? 0,
      preview: renderCampaign(id, { firstName: "Chris", scansLeft: id === "scans_left" ? 3 : 0, unsubUrl: sampleUnsub }),
    })),
    log: log.map((r) => ({ email: r.email, campaign: r.campaign, status: r.status, error: r.error, sentAt: Number(r.sent_at) })),
  };
}

/** One test mail to `to` (the owner), logged as a test so it never counts toward caps. */
export async function sendCampaignTest(id: CampaignId, to: string): Promise<void> {
  const m = renderCampaign(id, {
    firstName: "Chris",
    scansLeft: id === "scans_left" ? 3 : 0,
    unsubUrl: `${site()}/api/digest/unsubscribe?u=test&t=test&k=updates`,
  });
  try {
    await sendCampaignEmail(to, { ...m, subject: `[TEST] ${m.subject}` });
    await logSend({ userId: null, email: to, campaign: id, status: "test" });
  } catch (err) {
    await logSend({ userId: null, email: to, campaign: id, status: "failed", error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

function easternWeekday(now: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(new Date(now));
}

export interface CampaignSweepResult {
  skipped?: string;
  due: number;
  sent: number;
  failed: number;
}

/** The daily job's step: off, wrong day or no mail = nothing. `force` skips the day check only, never the switch or the caps. */
export async function sweepCampaigns(
  now = Date.now(),
  opts: { force?: boolean } = {},
  deps: { send?: typeof sendCampaignEmail; configured?: () => boolean; on?: () => Promise<boolean> } = {},
): Promise<CampaignSweepResult> {
  if (!(await (deps.on ?? campaignsOn)())) return { skipped: "switched off", due: 0, sent: 0, failed: 0 };
  if (!(deps.configured ?? isMailConfigured)()) return { skipped: "mail not configured", due: 0, sent: 0, failed: 0 };
  if (!opts.force && !(SEND_DAYS as readonly string[]).includes(easternWeekday(now))) return { skipped: `not a send day (${SEND_DAYS.join(", ")})`, due: 0, sent: 0, failed: 0 };
  const send = deps.send ?? sendCampaignEmail;
  const due = (await candidates(now)).filter((c) => !c.blocked).slice(0, USER_CAP);
  let sent = 0;
  let failed = 0;
  const wentOut = new Set<CampaignId>();
  for (const c of due) {
    try {
      const token = await digestTokenFor(c.user.id);
      const m = renderCampaign(c.id, { firstName: c.user.name ?? "", scansLeft: c.scansLeft, unsubUrl: unsubUrlFor(c.user.id, token) });
      await send(c.user.email, m);
      await logSend({ userId: c.user.id, email: c.user.email, campaign: c.id, status: "sent" }, now);
      sent++;
      wentOut.add(c.id);
    } catch (err) {
      failed++;
      await logSend({ userId: c.user.id, email: c.user.email, campaign: c.id, status: "failed", error: err instanceof Error ? err.message : String(err) }, now);
      console.error(`campaign ${c.id} to ${c.user.email} failed:`, err);
    }
  }
  // The owner's copy (Chris 10-07): one of each mail that reached somebody this run, never counted in caps.
  for (const id of wentOut) {
    try {
      const first = due.find((c) => c.id === id)!;
      const m = renderCampaign(id, { firstName: "Chris", scansLeft: first.scansLeft, unsubUrl: `${site()}/api/digest/unsubscribe?u=copy&t=copy&k=updates` });
      await send(OWNER_EMAIL, { ...m, subject: `[COPY] ${m.subject}` });
      await logSend({ userId: null, email: OWNER_EMAIL, campaign: id, status: "copy" }, now);
    } catch (err) {
      console.error(`campaign ${id} owner copy failed:`, err);
    }
  }
  return { due: due.length, sent, failed };
}

