import "server-only";
import { db } from "@/lib/db";
import { GAMES } from "@/lib/games";
import { PLAN_NAME, PRICE, SCANS } from "@/lib/pricing";
import { SITE_URL } from "@/lib/siteUrl";
import { ET_ZONE } from "@/lib/time";
import {
  CARDS_VARIANTS,
  CARDS_VARIANT_LABEL,
  SCANS_VARIANTS,
  SCANS_VARIANT_LABEL,
  TIPS,
  binderCards,
  cardsFacts,
  escapeHtml as esc,
  fiveGameCards,
  money,
  pct,
  rememberBinderCards,
  scansFacts,
  weekFacts,
  type CardsFacts,
  type CardsVariant,
  type MailCard,
  type ScansFacts,
  type ScansVariant,
  type WeekFacts,
} from "@/lib/server/campaignData";
import { EMAIL_CUTOFF, digestTokenFor } from "@/lib/server/digest";
import { isMailConfigured, sendCampaignEmail } from "@/lib/server/mail";
import { getSetting, setSetting } from "@/lib/server/settings";
import { OWNER_EMAIL, findUserByEmail, listAllUsers, type User } from "@/lib/server/users";

/**
 * The three weekly mails (docs/EMAILS.md, planned with Chris 10-08):
 *
 *   scans  Tuesday 10am ET   how many scans they have, with the right buttons
 *   cards  Thursday 10am ET  their movers, or cards worth checking the binder for
 *   week   Sunday 6:30pm ET  the week in cards (replaces the old Sunday digest)
 *
 * OFF until Chris flips the switch on /admin/emails (settings key
 * email_campaigns_on, only "1" is on). Test sends to the owner work while off.
 * Sent by /api/cron/emails at the hours above (vercel.json), never by the
 * morning daily job, so a mail lands when people read mail.
 *
 * Who gets mail: accounts made on or after 10-07 (EMAIL_CUTOFF), at least a
 * day old, confirmed, not opted out. One mail per person per day, the same
 * mail at most once a week. Admin accounts get none; the owner gets a [COPY]
 * of each mail that went out in a run. The Stop link reuses the digest token:
 * digest_off stops everything optional.
 */

export const CAMPAIGNS_ON_KEY = "email_campaigns_on";
export const CAMPAIGN_IDS = ["scans", "cards", "week"] as const;
export type CampaignId = (typeof CAMPAIGN_IDS)[number];

export const CAMPAIGN_LABEL: Record<CampaignId, string> = {
  scans: "Scans",
  cards: "Your cards",
  week: "This week in cards",
};
/** Eastern weekday + hour each mail goes out. The cron fires at both DST offsets; the route keeps the one that lands on the hour. */
export const CAMPAIGN_WHEN: Record<CampaignId, { day: string; hour: number; minute: number; label: string }> = {
  scans: { day: "Tue", hour: 10, minute: 0, label: "Tuesday 10:00am ET" },
  cards: { day: "Thu", hour: 10, minute: 0, label: "Thursday 10:00am ET" },
  week: { day: "Sun", hour: 18, minute: 30, label: "Sunday 6:30pm ET" },
};
export const SAME_GAP_DAYS = 6;
/** A brand-new account gets the signup welcome, not a campaign. */
const MIN_AGE_MS = 24 * 3_600_000;
export const SIGNUP_CUTOFF = EMAIL_CUTOFF;
const USER_CAP = 500;
const DAY = 86_400_000;

export async function campaignsOn(): Promise<boolean> {
  return (await getSetting(CAMPAIGNS_ON_KEY)) === "1";
}

export async function setCampaignsOn(on: boolean): Promise<void> {
  await setSetting(CAMPAIGNS_ON_KEY, on ? "1" : "0");
}

function etParts(now: number): { weekday: string; hour: number; day: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ET_ZONE, weekday: "short", hour: "numeric", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { weekday: get("weekday"), hour: Number(get("hour")) % 24, day: `${get("year")}-${get("month")}-${get("day")}` };
}

/** The mail due on this Eastern day, if any. */
export function campaignDueOn(now = Date.now()): CampaignId | null {
  const { weekday } = etParts(now);
  return CAMPAIGN_IDS.find((id) => CAMPAIGN_WHEN[id].day === weekday) ?? null;
}

/** True inside the send hour of today's mail (the cron fires at both DST offsets; one of them is this hour). */
export function inSendHour(id: CampaignId, now = Date.now()): boolean {
  return etParts(now).hour === CAMPAIGN_WHEN[id].hour;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
  unsubUrl: string;
}

const BRAND = "#6d5dfc";
const button = (href: string, label: string, color = BRAND) =>
  `<a href="${href}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 18px;border-radius:999px;background:${color};color:#fff;text-decoration:none;font-weight:600">${esc(label)}</a>`;
const greet = (firstName: string) => {
  const first = firstName.replace(/[\r\n]+/g, " ").trim().split(/\s+/)[0] ?? "";
  return first ? `Hi ${first},` : "Hi,";
};
const dateET = (ms: number) => new Date(ms).toLocaleDateString("en-US", { timeZone: ET_ZONE, month: "short", day: "numeric" });

interface Block {
  /** Small caps heading, optional. */
  title?: string;
  lines?: string[];
  /** Card rows render with a picture in HTML; the text version lists them. */
  cards?: MailCard[];
}

function cardRowText(c: MailCard): string {
  const move = c.before != null && c.before > 0 && c.before !== c.price ? ` (was ${money(c.before)}, ${pct(((c.price - c.before) / c.before) * 100)})` : "";
  return `${c.name} · ${c.set} ${c.number}${c.note === "watching" ? " · watching" : ""} — ${money(c.price)}${move}`;
}

function cardRowHtml(c: MailCard): string {
  const up = c.before != null && c.price > c.before;
  const down = c.before != null && c.price < c.before;
  const move =
    c.before != null && c.before > 0 && c.before !== c.price
      ? `<span style="color:${up ? "#15803d" : "#b91c1c"};font-weight:600">${pct(((c.price - c.before) / c.before) * 100)}</span> <span style="color:#666">was ${money(c.before)}</span>`
      : "";
  void down;
  const pic = c.image
    ? `<img src="${esc(c.image)}" width="56" height="78" alt="" style="display:block;width:56px;height:78px;object-fit:cover;border-radius:6px;background:#eee">`
    : `<div style="width:56px;height:78px;border-radius:6px;background:#eee"></div>`;
  return `<tr>
    <td style="padding:8px 10px 8px 0;vertical-align:middle;width:56px"><a href="${esc(c.url)}">${pic}</a></td>
    <td style="padding:8px 0;vertical-align:middle;border-bottom:1px solid #eee">
      <a href="${esc(c.url)}" style="color:#111;text-decoration:none;font-weight:600">${esc(c.name)}</a>${c.note === "watching" ? ` <span style="color:#6d5dfc;font-size:12px">watching</span>` : ""}<br>
      <span style="color:#666;font-size:13px">${esc(c.set)} · ${esc(c.number)} · ${esc(GAMES[c.game].label)}</span><br>
      <span style="font-weight:700">${money(c.price)}</span> ${move}
    </td></tr>`;
}

/** The one layout every mail uses: greeting, headline, blocks, buttons, the Stop link. */
function layout(v: { subject: string; firstName: string; headline: string; intro?: string; blocks: Block[]; buttons: Array<{ href: string; label: string; color?: string }>; unsubUrl: string }): RenderedMail {
  const hi = greet(v.firstName);
  const text = [
    hi,
    "",
    v.headline,
    ...(v.intro ? [v.intro] : []),
    "",
    ...v.blocks.flatMap((b) => [...(b.title ? [b.title.toUpperCase()] : []), ...(b.lines ?? []), ...(b.cards ?? []).map((c) => "· " + cardRowText(c)), ""]),
    ...v.buttons.map((b) => `${b.label}: ${b.href}`),
    "",
    `Stop these emails: ${v.unsubUrl}`,
    "",
    "— CardFlip · support@cardflip.io",
  ].join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;color:#111;max-width:520px">
    <p style="margin:0 0 12px">${esc(hi)}</p>
    <p style="font-size:19px;font-weight:700;margin:0 0 6px">${esc(v.headline)}</p>
    ${v.intro ? `<p style="margin:0 0 14px;color:#444">${esc(v.intro)}</p>` : ""}
    ${v.blocks
      .map(
        (b) => `${b.title ? `<p style="margin:18px 0 4px;font-size:12px;letter-spacing:.06em;color:#666;font-weight:700">${esc(b.title.toUpperCase())}</p>` : ""}
      ${(b.lines ?? []).map((l) => `<p style="margin:0 0 6px">${esc(l)}</p>`).join("")}
      ${b.cards?.length ? `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">${b.cards.map(cardRowHtml).join("")}</table>` : ""}`,
      )
      .join("")}
    <p style="margin:20px 0 8px">${v.buttons.map((b) => button(b.href, b.label, b.color)).join("")}</p>
    <p style="color:#666;font-size:13px;margin:16px 0 4px"><a href="${v.unsubUrl}" style="color:#666">Stop these emails</a>.</p>
    <p style="color:#999;font-size:12px;margin:0">— CardFlip · support@cardflip.io</p>
  </div>`;
  return { subject: v.subject, text, html, unsubUrl: v.unsubUrl };
}

const tipBlock = (f: { tip: keyof typeof TIPS | null }): Block[] => (f.tip ? [{ title: "One tip", lines: [TIPS[f.tip].text] }] : []);

export function renderScans(f: ScansFacts, firstName: string, unsubUrl: string): RenderedMail {
  const scan = { href: `${SITE_URL}/scan`, label: "Scan a Card" };
  const booster = { href: `${SITE_URL}/pricing`, label: `${PLAN_NAME.pack} · ${PRICE.pack}` };
  const subscribe = { href: `${SITE_URL}/pricing`, label: `Subscribe · ${PRICE.standard}/mo` };
  const pro = { href: `${SITE_URL}/pricing`, label: `Move to ${PLAN_NAME.pro} · ${SCANS.pro}/mo` };
  const n = f.left;
  const s = (k: number) => (k === 1 ? "" : "s");
  const next = f.nextCreditAt ? `Your next ${f.included} scans arrive on ${dateET(f.nextCreditAt)}.` : "";

  switch (f.variant) {
    case "trial_left":
      return layout({
        subject: `You still have ${n} free scan${s(n)}`,
        firstName,
        headline: `You still have ${n} free scan${s(n)} on CardFlip.`,
        intro: "Point your phone camera at any card. CardFlip names it, prices it, and writes the eBay listing.",
        blocks: tipBlock(f),
        buttons: [scan],
        unsubUrl,
      });
    case "trial_out":
      return layout({
        subject: "You're out of free scans",
        firstName,
        headline: `You used all ${SCANS.trial} free scans. Want to keep going?`,
        blocks: [
          { lines: [`${PLAN_NAME.pack}: ${PRICE.pack} one time for ${SCANS.pack} scans. No subscription, never expires.`, `${PLAN_NAME.standard} plan: ${PRICE.standard} a month for ${SCANS.standard} scans.`] },
          ...tipBlock(f),
        ],
        buttons: [{ ...booster, label: `Buy ${SCANS.pack} Scans · ${PRICE.pack}` }, subscribe],
        unsubUrl,
      });
    case "sub_plenty":
      return layout({
        subject: `You still have ${n} scans`,
        firstName,
        headline: `You still have ${n} of ${f.included} scans.`,
        intro: [next, "Scans never expire, but the quickest way to find out what your cards are worth is to use them."].filter(Boolean).join(" "),
        blocks: tipBlock(f),
        buttons: [scan],
        unsubUrl,
      });
    case "sub_low":
      return layout({
        subject: n > 0 ? `You have ${n} scan${s(n)} left` : "You're out of scans",
        firstName,
        headline: n > 0 ? `You have ${n} scan${s(n)} left.` : "You're out of scans.",
        intro: next || "Top up any time and keep scanning.",
        blocks: [{ lines: [`${PLAN_NAME.pack}: ${PRICE.pack} one time for ${SCANS.pack} more scans, on top of your plan.`, ...(f.plan === "standard" ? [`${PLAN_NAME.pro}: ${PRICE.pro} a month for ${SCANS.pro} scans.`] : [])] }, ...tipBlock(f)],
        buttons: [booster, ...(f.plan === "standard" ? [pro] : [])],
        unsubUrl,
      });
    case "sub_month": {
      const m = f.month ?? { scans: 0, cardsAdded: 0, valueChange: null };
      const value = m.valueChange == null ? "" : m.valueChange >= 0 ? `collection up ${money(m.valueChange)}` : `collection down ${money(-m.valueChange)}`;
      const line = [`${m.scans} scan${s(m.scans)}`, `${m.cardsAdded} card${s(m.cardsAdded)} added`, value].filter(Boolean).join(", ");
      return layout({
        subject: `Your week: ${line}`,
        firstName,
        headline: `This week: ${line}.`,
        intro: [`You have ${n} scans left.`, next].filter(Boolean).join(" "),
        blocks: tipBlock(f),
        buttons: [{ href: `${SITE_URL}/app/collection`, label: "Open Inventory" }],
        unsubUrl,
      });
    }
  }
}

export function renderCards(f: CardsFacts, firstName: string, unsubUrl: string): RenderedMail {
  const scan = { href: `${SITE_URL}/scan`, label: "Scan a Card" };
  if (f.variant === "movers") {
    const top = f.cards[0];
    const up = top.before != null && top.price > top.before;
    return layout({
      subject: `${top.name} ${up ? "went up" : "went down"} this week`,
      firstName,
      headline: "Your cards this week.",
      intro: "The biggest moves in your inventory and watchlist over the last 7 days.",
      blocks: [{ cards: f.cards }],
      buttons: [{ href: `${SITE_URL}/app/collection`, label: "See All Your Cards" }],
      unsubUrl,
    });
  }
  const waiting = f.trialLeft != null && f.trialLeft > 0;
  if (f.variant === "binder" && f.game) {
    return layout({
      subject: waiting ? `Your ${f.trialLeft} free scans are waiting` : `Worth checking your binder for`,
      firstName,
      headline: waiting ? `Your ${f.trialLeft} free scans are waiting.` : "Worth checking your binder for.",
      intro: `Three ${GAMES[f.game].label} cards that look ordinary but went up this week. Got one? Scan it and see.`,
      blocks: [{ cards: f.cards }],
      buttons: [scan],
      unsubUrl,
    });
  }
  return layout({
    subject: waiting ? `Your ${f.trialLeft} free scans are waiting` : "This week's biggest card in each game",
    firstName,
    headline: waiting ? `Your ${f.trialLeft} free scans are waiting.` : "This week's biggest card in each game.",
    intro: "One card from each of the five games CardFlip prices. Got any of these? Scan it and see what it's worth.",
    blocks: [{ cards: f.cards }],
    buttons: [scan],
    unsubUrl,
  });
}

export function renderWeek(f: WeekFacts, firstName: string, unsubUrl: string): RenderedMail {
  const fmt = (p: number | null) => (p == null ? "new" : `${p > 0 ? "up" : p < 0 ? "down" : "flat"} ${Math.abs(p).toFixed(1)}%`);
  const best = f.games.filter((g) => g.movePct != null).sort((a, b) => (b.movePct ?? 0) - (a.movePct ?? 0));
  const subject =
    best.length >= 2 && (best[0].movePct ?? 0) > 0 && (best[best.length - 1].movePct ?? 0) < 0
      ? `This week in cards: ${best[0].label} up, ${best[best.length - 1].label} down`
      : f.jump
        ? `This week in cards: ${f.jump.name} ${pct(f.jump.pct)}`
        : "This week in cards";
  const blocks: Block[] = [
    { title: "The week", lines: f.games.map((g) => `${g.label}: ${fmt(g.movePct)} · ${g.note}`) },
    ...(f.jump ? [{ title: "Biggest jump", lines: [`${f.jump.name} (${f.jump.set} ${f.jump.number}): ${f.jump.before != null ? `${money(f.jump.before)} → ` : ""}${money(f.jump.price)}, ${pct(f.jump.pct)}`] }] : []),
    ...(f.set ? [{ title: "Set to watch", lines: [`${f.set.name} (${GAMES[f.set.game].label}): ${f.set.risers} of the top 20 risers came from this set.`] }] : []),
    ...(f.sleeper ? [{ title: "Sleeper under $5", lines: [`${f.sleeper.name} (${GAMES[f.sleeper.game].label}, ${f.sleeper.set}): ${money(f.sleeper.price)}, ${pct(f.sleeper.pct)} this week.`] }] : []),
    { title: "On CardFlip this week", lines: [`${f.scans.toLocaleString("en-US")} card${f.scans === 1 ? "" : "s"} scanned.${f.mostScanned ? ` Most scanned: ${f.mostScanned}.` : ""}`] },
  ];
  return layout({ subject, firstName, headline: "This week in cards.", blocks, buttons: [{ href: `${SITE_URL}/app/collection`, label: "Check Your Cards" }], unsubUrl });
}

/* ------------------------------------------------------------------ */
/* Who gets what                                                       */
/* ------------------------------------------------------------------ */

function unsubUrlFor(userId: string, token: string): string {
  return `${SITE_URL}/api/digest/unsubscribe?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}&k=updates`;
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

async function sendHistory(): Promise<Map<string, SendRow[]>> {
  const rows = (await db
    .prepare("SELECT user_id, campaign, sent_at FROM email_sends WHERE status = 'sent' AND user_id IS NOT NULL ORDER BY sent_at DESC")
    .all()) as unknown as SendRow[];
  const out = new Map<string, SendRow[]>();
  for (const r of rows) out.set(r.user_id, [...(out.get(r.user_id) ?? []), r]);
  return out;
}

/** Why a person is skipped today, or null when the mail may go. One mail a day; the same mail once a week. */
export function capBlocks(history: SendRow[] | undefined, id: CampaignId, now = Date.now()): string | null {
  if (!history?.length) return null;
  const today = etParts(now).day;
  if (history.some((r) => etParts(r.sent_at).day === today)) return "already mailed today";
  const same = history.find((r) => r.campaign === id);
  if (same && now - same.sent_at < SAME_GAP_DAYS * DAY) return "had this mail this week";
  return null;
}

export interface Candidate {
  user: User;
  blocked: string | null;
}

/** Everyone a mail would reach today, with the cap verdict for each. */
export async function candidates(id: CampaignId, now = Date.now()): Promise<Candidate[]> {
  const offRows = (await db.prepare("SELECT id FROM users WHERE digest_off = 1 OR email_pending = 1").all()) as unknown as Array<{ id: string }>;
  const off = new Set(offRows.map((r) => r.id));
  const history = await sendHistory();
  const out: Candidate[] = [];
  for (const user of await listAllUsers()) {
    if (user.role === "admin" || off.has(user.id) || user.createdAt < SIGNUP_CUTOFF || now - user.createdAt < MIN_AGE_MS) continue;
    out.push({ user, blocked: capBlocks(history.get(user.id), id, now) });
  }
  return out;
}

/** The mail for one person, or null when there is nothing to say to them (owner/legacy tiers on Tuesday). */
export async function buildMail(id: CampaignId, user: User, unsubUrl: string, now: number, shared: { week?: WeekFacts; five?: MailCard[] } = {}): Promise<{ mail: RenderedMail; facts: ScansFacts | CardsFacts | WeekFacts } | null> {
  const first = user.name ?? "";
  if (id === "scans") {
    const f = await scansFacts(user, now);
    return f ? { mail: renderScans(f, first, unsubUrl), facts: f } : null;
  }
  if (id === "cards") {
    const f = await cardsFacts(user, now, shared);
    return f.cards.length ? { mail: renderCards(f, first, unsubUrl), facts: f } : null;
  }
  const f = shared.week ?? (await weekFacts(now));
  if (!f) return null;
  shared.week = f;
  return { mail: renderWeek(f, first, unsubUrl), facts: f };
}

/* ------------------------------------------------------------------ */
/* Admin: previews, tests, overview                                    */
/* ------------------------------------------------------------------ */

const SAMPLE_UNSUB = `${SITE_URL}/api/digest/unsubscribe?u=preview&t=preview&k=updates`;
const inDays = (n: number, now: number) => now + n * DAY;

/** Sample facts for each Tuesday variant, so the admin page shows every version without a matching real account. */
function sampleScans(v: ScansVariant, now: number): ScansFacts {
  switch (v) {
    case "trial_left":
      return { variant: v, left: 3, included: 5, nextCreditAt: null, plan: null, tip: "ebay" };
    case "trial_out":
      return { variant: v, left: 0, included: 5, nextCreditAt: null, plan: null, tip: "watchlist" };
    case "sub_plenty":
      return { variant: v, left: 230, included: 250, nextCreditAt: inDays(12, now), plan: "standard", tip: "watchlist" };
    case "sub_low":
      return { variant: v, left: 18, included: 250, nextCreditAt: inDays(12, now), plan: "standard", tip: "sets" };
    case "sub_month":
      return { variant: v, left: 112, included: 250, nextCreditAt: inDays(12, now), plan: "pro", month: { scans: 31, cardsAdded: 27, valueChange: 41.2 }, tip: "ebay" };
  }
}

export type VariantKey = `scans:${ScansVariant}` | `cards:${CardsVariant}` | "week";
export const VARIANT_KEYS: VariantKey[] = [...SCANS_VARIANTS.map((v) => `scans:${v}` as const), ...CARDS_VARIANTS.map((v) => `cards:${v}` as const), "week"];

/** One preview per variant: Tuesday from sample numbers, Thursday + Sunday from today's real catalog data (the owner's cards for "movers"). */
/** Shown while a day's facts are still being read in the background (admin page only). */
const BUILDING: RenderedMail = {
  subject: "(building the preview, reload in a minute)",
  text: "Reading today's prices. Reload in a minute.",
  html: `<p style="color:#666">Reading today's prices for this preview. Reload the page in a minute.</p>`,
  unsubUrl: SAMPLE_UNSUB,
};

/** One preview per variant: Tuesday from sample numbers, Thursday + Sunday from today's real catalog data (the owner's cards for "movers"). `quick` = cached facts only, never a long walk. */
export async function previewVariant(key: VariantKey, now = Date.now(), quick = false): Promise<RenderedMail> {
  const first = "Chris";
  if (key.startsWith("scans:")) return renderScans(sampleScans(key.slice(6) as ScansVariant, now), first, SAMPLE_UNSUB);
  if (key === "week") {
    const f = await weekFacts(now, quick);
    return f ? renderWeek(f, first, SAMPLE_UNSUB) : BUILDING;
  }
  const v = key.slice(6) as CardsVariant;
  if (v === "movers") {
    const owner = await findUserByEmail(OWNER_EMAIL);
    const f = owner ? await cardsFacts(owner, now, {}, quick) : null;
    if (f && f.variant === "movers") return renderCards(f, first, SAMPLE_UNSUB);
    // No real movers to show: a note instead of a fake list.
    const five = await fiveGameCards(now, quick);
    if (!five) return BUILDING;
    return renderCards({ variant: "movers", game: null, cards: (f?.cards.length ? f.cards : five).slice(0, 3), trialLeft: null }, first, SAMPLE_UNSUB);
  }
  if (v === "binder") {
    for (const game of ["pokemon", "mtg"] as const) {
      const cards = await binderCards(game, now, 3, quick);
      if (cards && cards.length >= 3) return renderCards({ variant: "binder", game, cards, trialLeft: 5 }, first, SAMPLE_UNSUB);
    }
    const five = await fiveGameCards(now, quick);
    if (!five) return BUILDING;
    return renderCards({ variant: "binder", game: "pokemon", cards: five.slice(0, 3), trialLeft: 5 }, first, SAMPLE_UNSUB);
  }
  const five = await fiveGameCards(now, quick);
  return five ? renderCards({ variant: "five", game: null, cards: five, trialLeft: 5 }, first, SAMPLE_UNSUB) : BUILDING;
}

export interface CampaignOverview {
  on: boolean;
  mailConfigured: boolean;
  campaigns: Array<{
    id: CampaignId;
    label: string;
    when: string;
    eligible: number;
    dueNext: number;
    sent: number;
    variants: Array<{ key: VariantKey; label: string; count: number | null; preview: RenderedMail }>;
  }>;
  log: Array<{ email: string; campaign: string; status: string; error: string | null; sentAt: number }>;
}

/** Everything /admin/emails shows. Variant counts say how many people would get each version next run. */
export async function campaignOverview(now = Date.now()): Promise<CampaignOverview> {
  const sentRows = (await db.prepare("SELECT campaign, COUNT(*) AS n FROM email_sends WHERE status = 'sent' GROUP BY campaign").all()) as unknown as Array<{ campaign: string; n: number }>;
  const sent = new Map(sentRows.map((r) => [r.campaign, Number(r.n)]));
  const log = (await db
    .prepare("SELECT email, campaign, status, error, sent_at FROM email_sends ORDER BY sent_at DESC LIMIT 100")
    .all()) as unknown as Array<{ email: string; campaign: string; status: string; error: string | null; sent_at: number }>;

  const campaigns: CampaignOverview["campaigns"] = [];
  for (const id of CAMPAIGN_IDS) {
    const list = await candidates(id, now);
    const due = list.filter((c) => !c.blocked);
    const counts = new Map<string, number>();
    if (id === "scans") {
      for (const c of due) {
        const v = (await scansFacts(c.user, now))?.variant ?? "none";
        counts.set(v, 1 + (counts.get(v) ?? 0));
      }
    }
    const keys: VariantKey[] = id === "scans" ? SCANS_VARIANTS.map((v) => `scans:${v}` as const) : id === "cards" ? CARDS_VARIANTS.map((v) => `cards:${v}` as const) : ["week"];
    const variants = [];
    for (const key of keys) {
      const v = key.includes(":") ? key.slice(key.indexOf(":") + 1) : "";
      const label = id === "scans" ? SCANS_VARIANT_LABEL[v as ScansVariant] : id === "cards" ? CARDS_VARIANT_LABEL[v as CardsVariant] : "Everyone";
      let preview: RenderedMail;
      try {
        preview = await previewVariant(key, now, true);
      } catch (err) {
        preview = { subject: "(preview failed)", text: String(err), html: `<p style="color:#b91c1c">Preview failed: ${esc(err instanceof Error ? err.message : String(err))}</p>`, unsubUrl: SAMPLE_UNSUB };
      }
      variants.push({ key, label, count: id === "scans" ? (counts.get(v) ?? 0) : null, preview });
    }
    campaigns.push({ id, label: CAMPAIGN_LABEL[id], when: CAMPAIGN_WHEN[id].label, eligible: list.length, dueNext: due.length, sent: sent.get(id) ?? 0, variants });
  }
  return {
    on: await campaignsOn(),
    mailConfigured: isMailConfigured(),
    campaigns,
    log: log.map((r) => ({ email: r.email, campaign: r.campaign, status: r.status, error: r.error, sentAt: Number(r.sent_at) })),
  };
}

/** One variant's test mail to the owner, logged as a test so it never counts toward caps. */
export async function sendCampaignTest(key: VariantKey, to: string, now = Date.now(), deps: { send?: typeof sendCampaignEmail } = {}): Promise<void> {
  const m = await previewVariant(key, now);
  const campaign = key.split(":")[0];
  try {
    await (deps.send ?? sendCampaignEmail)(to, { ...m, subject: `[TEST] ${m.subject}` });
    await logSend({ userId: null, email: to, campaign: `${campaign} test`, status: "test" }, now);
  } catch (err) {
    await logSend({ userId: null, email: to, campaign: `${campaign} test`, status: "failed", error: err instanceof Error ? err.message : String(err) }, now);
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* The send                                                            */
/* ------------------------------------------------------------------ */

export interface CampaignSweepResult {
  campaign: CampaignId | null;
  skipped?: string;
  due: number;
  sent: number;
  failed: number;
}

/**
 * Today's mail to everyone due. `force` skips the weekday/hour check only,
 * never the switch or the caps; `only` picks the mail instead of the weekday.
 */
export async function sweepCampaigns(
  now = Date.now(),
  opts: { force?: boolean; only?: CampaignId } = {},
  deps: { send?: typeof sendCampaignEmail; configured?: () => boolean; on?: () => Promise<boolean> } = {},
): Promise<CampaignSweepResult> {
  const id = opts.only ?? campaignDueOn(now);
  const none = (skipped: string): CampaignSweepResult => ({ campaign: id, skipped, due: 0, sent: 0, failed: 0 });
  if (!(await (deps.on ?? campaignsOn)())) return none("switched off");
  if (!(deps.configured ?? isMailConfigured)()) return none("mail not configured");
  if (!id) return none("no mail today");
  if (!opts.force && !opts.only && !inSendHour(id, now)) return none(`not the send hour (${CAMPAIGN_WHEN[id].label})`);
  const send = deps.send ?? sendCampaignEmail;
  const due = (await candidates(id, now)).filter((c) => !c.blocked).slice(0, USER_CAP);
  let sent = 0;
  let failed = 0;
  let copy: RenderedMail | null = null;
  const shared: { week?: WeekFacts; five?: MailCard[] } = {};
  const binder: MailCard[] = [];
  for (const c of due) {
    try {
      const token = await digestTokenFor(c.user.id);
      const built = await buildMail(id, c.user, unsubUrlFor(c.user.id, token), now, shared);
      if (!built) continue;
      await send(c.user.email, built.mail);
      await logSend({ userId: c.user.id, email: c.user.email, campaign: id, status: "sent" }, now);
      sent++;
      copy ??= built.mail;
      if (id === "cards" && (built.facts as CardsFacts).variant === "binder") binder.push(...(built.facts as CardsFacts).cards);
    } catch (err) {
      failed++;
      await logSend({ userId: c.user.id, email: c.user.email, campaign: id, status: "failed", error: err instanceof Error ? err.message : String(err) }, now);
      console.error(`campaign ${id} to ${c.user.email} failed:`, err);
    }
  }
  if (binder.length) await rememberBinderCards(binder).catch((err) => console.warn("binder memory failed:", err));
  // The owner's copy: the first mail that reached somebody this run, never counted in caps.
  if (copy) {
    try {
      await send(OWNER_EMAIL, { ...copy, subject: `[COPY] ${copy.subject}` });
      await logSend({ userId: null, email: OWNER_EMAIL, campaign: id, status: "copy" }, now);
    } catch (err) {
      console.error(`campaign ${id} owner copy failed:`, err);
    }
  }
  return { campaign: id, due: due.length, sent, failed };
}
