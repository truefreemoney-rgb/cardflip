import "server-only";
import nodemailer from "nodemailer";
import { FROZEN_SENTENCE, PRICE, PRICING, ROLLOVER_SENTENCE, SCANS } from "@/lib/pricing";
import type { Digest } from "@/lib/server/digest";
import { PRICE_FLAG_LEFT_OUT_NEXT, priceFlagLeftOut } from "@/lib/priceFlag";

/**
 * Outbound mail — the password-reset link and the subscription welcome.
 *
 * Plain SMTP with an app password, because the site's mailbox
 * (support@cardflip.io) already lives at Fastmail and Fastmail
 * offers authenticated SMTP with no DNS work: nothing to add at Dynadot,
 * DKIM already passes. Configure with Fly secrets:
 *
 *   SMTP_HOST=smtp.fastmail.com  SMTP_PORT=465
 *   SMTP_USER=support@cardflip.io  SMTP_PASS=<Fastmail app password>
 *   MAIL_FROM="CardFlip <support@cardflip.io>"   (optional; defaults to SMTP_USER)
 *
 * Unconfigured is a first-class state: isMailConfigured() gates the UI so
 * "Forgot password?" tells the truth instead of pretending to send.
 */

export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * Local and CI only: with EMAIL_CONFIRM_DEV_ECHO=1 the email-confirmation code
 * is logged instead of mailed, so the flow can be walked without SMTP. Never
 * honoured in production, whatever the environment says.
 */
export function emailConfirmDevEcho(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.EMAIL_CONFIRM_DEV_ECHO === "1";
}

/**
 * Can a confirmation code be delivered at all? Read at request time (never
 * cached) so the wall lifts by itself if the SMTP variables ever disappear
 * from a deploy; users.needsEmailConfirm and the signup route both ask this.
 */
export function emailConfirmActive(): boolean {
  return isMailConfigured() || emailConfirmDevEcho();
}

function transport() {
  const host = process.env.SMTP_HOST!;
  const port = Number(process.env.SMTP_PORT ?? 465);
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    // A stalled server must fail in seconds, not hold a signup or a resend
    // past the phone's 15 s request timeout (nodemailer's own defaults are
    // 30 s for the greeting and 10 minutes of socket silence).
    connectionTimeout: 10000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
  });
}

/**
 * Connect and log in to the SMTP server without sending anything: the
 * heartbeat behind /api/ops/mail-check. A revoked app password or a dead
 * mailbox shows up here before a signup finds it.
 */
export async function verifyMailTransport(): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  await transport().verify();
}

function fromAddress(): string {
  return process.env.MAIL_FROM ?? `CardFlip <${process.env.SMTP_USER}>`;
}

export async function sendPasswordResetEmail(to: string, url: string): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const text = [
    "Someone asked to reset the password for your CardFlip account.",
    "",
    `Reset it here (link works once, for 1 hour):`,
    url,
    "",
    "If that wasn't you, ignore this — your password hasn't changed.",
    "",
    "— CardFlip · support@cardflip.io",
  ].join("\n");
  const html = `
    <p>Someone asked to reset the password for your CardFlip account.</p>
    <p><a href="${url}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">Reset password</a></p>
    <p style="color:#666;font-size:13px">The link works once, for 1 hour. If the button doesn't work, paste this into your browser:<br><a href="${url}">${url}</a></p>
    <p style="color:#666;font-size:13px">If that wasn't you, ignore this — your password hasn't changed.</p>
    <p style="color:#999;font-size:12px">— CardFlip · support@cardflip.io</p>`;
  await transport().sendMail({
    from: fromAddress(),
    to,
    subject: "Reset your CardFlip password",
    text,
    html,
  });
}

/**
 * The email-confirmation mail (emailVerify.ts): a 6-digit code to type in the
 * app, plus a button that confirms the same request from any browser. Nothing
 * a user typed goes in it (no name, no subject), so it can be sent to an
 * address nobody has proven yet without carrying anyone's words to a stranger.
 */
export async function sendConfirmEmail(to: string, code: string, url: string): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const text = [
    `Your CardFlip code is ${code}`,
    "",
    "Type it in the app, or open this link to confirm your email:",
    url,
    "",
    "The code and the link work for 1 hour. If you didn't sign up for CardFlip, ignore this email.",
    "",
    "— CardFlip · support@cardflip.io",
  ].join("\n");
  const html = `
    <p>Your CardFlip code is:</p>
    <p style="font-size:32px;font-weight:700;letter-spacing:4px;margin:4px 0 16px">${code}</p>
    <p>Type it in the app, or tap the button to confirm your email.</p>
    <p><a href="${esc(url)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">Confirm Email</a></p>
    <p style="color:#666;font-size:13px">The code and the button work for 1 hour. If you didn't sign up for CardFlip, ignore this email.</p>
    <p style="color:#999;font-size:12px">— CardFlip · support@cardflip.io</p>`;
  await transport().sendMail({
    from: fromAddress(),
    to,
    subject: `${code} Is Your CardFlip Code`,
    text,
    html,
  });
}

export interface WishlistAlertHit {
  name: string;
  set: string;
  number: string;
  price: number;
  target: number;
}

/** "It dipped to your price" — one mail per user per daily pass (wishlistAlerts.ts). */
export async function sendWishlistAlertEmail(to: string, hits: WishlistAlertHit[]): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip.io";
  const line = (h: WishlistAlertHit) =>
    `${h.name} (${h.set} · ${h.number}) — now $${h.price.toFixed(2)}, your alert was $${h.target.toFixed(2)}`;
  const text = [
    hits.length === 1
      ? "A card on your CardFlip watchlist dipped to your alert price."
      : `${hits.length} cards on your CardFlip watchlist dipped to your alert prices.`,
    "",
    ...hits.map((h) => "· " + line(h)),
    "",
    `Your watchlist: ${site}/app/wishlist`,
    "",
    "Prices refresh once a day. This alert won't repeat unless you set a new target.",
    "",
    "— CardFlip · support@cardflip.io",
  ].join("\n");
  const html = `
    <p>${hits.length === 1 ? "A card on your CardFlip watchlist dipped to your alert price." : `${hits.length} cards on your CardFlip watchlist dipped to your alert prices.`}</p>
    <ul>${hits.map((h) => `<li>${line(h).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</li>`).join("")}</ul>
    <p><a href="${site}/app/wishlist" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">Open your watchlist</a></p>
    <p style="color:#666;font-size:13px">Prices refresh once a day. This alert won't repeat unless you set a new target.</p>
    <p style="color:#999;font-size:12px">— CardFlip · support@cardflip.io</p>`;
  await transport().sendMail({
    from: fromAddress(),
    to,
    subject:
      hits.length === 1
        ? `${hits[0].name} dipped to $${hits[0].price.toFixed(2)}`
        : `${hits.length} watchlist cards hit your alert prices`,
    text,
    html,
  });
}

export interface CardAlertHit {
  name: string;
  set: string;
  number: string;
  /** Asking price today. */
  price: number;
  /** The seller's target ("target"), or the price a week ago ("spike"). */
  target: number;
  kind: "target" | "spike";
}

/** Owned cards: "it reached your price" and "sell now, it spiked" — one mail per user per daily pass (cardAlerts.ts). */
export async function sendCardAlertEmail(to: string, hits: CardAlertHit[]): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip.io";
  const targets = hits.filter((h) => h.kind === "target");
  const spikes = hits.filter((h) => h.kind === "spike");
  const tLine = (h: CardAlertHit) => `${h.name} (${h.set} · ${h.number}) — now $${h.price.toFixed(2)}, your alert was $${h.target.toFixed(2)}`;
  const sLine = (h: CardAlertHit) => {
    const pct = h.target > 0 ? Math.round(((h.price - h.target) / h.target) * 100) : 0;
    return `${h.name} (${h.set} · ${h.number}) — $${h.price.toFixed(2)}, up ${pct}% from $${h.target.toFixed(2)} a week ago`;
  };
  const blocks: Array<{ head: string; lines: string[] }> = [];
  if (targets.length) blocks.push({ head: targets.length === 1 ? "A card you own reached your alert price." : `${targets.length} cards you own reached your alert prices.`, lines: targets.map(tLine) });
  if (spikes.length) blocks.push({ head: spikes.length === 1 ? "Sell now? A card you own spiked this week." : `Sell now? ${spikes.length} cards you own spiked this week.`, lines: spikes.map(sLine) });
  const text = [
    ...blocks.flatMap((b) => [b.head, ...b.lines.map((l) => "· " + l), ""]),
    `Your collection: ${site}/app/collection`,
    "",
    "Prices refresh once a day. A price alert won't repeat unless you set a new target; a spike note comes at most once a month per card.",
    "",
    "— CardFlip · support@cardflip.io",
  ].join("\n");
  const html = `
    ${blocks.map((b) => `<p>${esc(b.head)}</p><ul>${b.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`).join("")}
    <p><a href="${site}/app/collection" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">Open your collection</a></p>
    <p style="color:#666;font-size:13px">Prices refresh once a day. A price alert won't repeat unless you set a new target; a spike note comes at most once a month per card.</p>
    <p style="color:#999;font-size:12px">— CardFlip · support@cardflip.io</p>`;
  const first = targets[0] ?? spikes[0];
  await transport().sendMail({
    from: fromAddress(),
    to,
    subject:
      hits.length === 1
        ? first.kind === "target"
          ? `${first.name} reached $${first.price.toFixed(2)}`
          : `Sell now? ${first.name} is up to $${first.price.toFixed(2)}`
        : `${hits.length} cards you own moved to your prices`,
    text,
    html,
  });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n: number) => `${n >= 0 ? "+" : "-"}${usd(Math.abs(n))}`;

/** Sunday collection digest — one mail per seller per week (lib/server/digest.ts). */
export async function sendWeeklyDigestEmail(to: string, d: Digest, unsub: { userId: string; token: string }): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip.io";
  const unsubUrl = `${site}/api/digest/unsubscribe?u=${encodeURIComponent(unsub.userId)}&t=${encodeURIComponent(unsub.token)}`;
  const change = d.valueNow - d.valueBefore;
  const pct = d.valueBefore > 0 ? Math.round((change / d.valueBefore) * 1000) / 10 : 0;
  const headline = `Your collection is worth ${usd(d.valueNow)} (${signed(change)}${d.valueBefore > 0 ? `, ${pct >= 0 ? "+" : ""}${pct}%` : ""} this week)`;
  const cardLine = (c: { name: string; set: string; number: string; now: number; change: number; pct: number }) =>
    `${c.name} (${c.set} · ${c.number}) — ${usd(c.now)}, ${signed(c.change)} (${c.pct >= 0 ? "+" : ""}${c.pct}%)`;
  const soldLine = (c: { name: string; set: string; number: string; price: number }) => `${c.name} (${c.set} · ${c.number}) — sold for ${usd(c.price)}`;
  const staleLine = (c: { name: string; set: string; number: string; price: number; days: number }) => `${c.name} (${c.set} · ${c.number}) — ${usd(c.price)}, listed ${c.days} days`;

  // The price guard: cards whose market price looks off are left out of the numbers above, said once, plainly.
  const leftOutNote = d.leftOut ? `${priceFlagLeftOut(d.leftOut)}. ${PRICE_FLAG_LEFT_OUT_NEXT}` : "";
  const sections: Array<{ title: string; lines: string[]; empty?: string }> = [
    { title: "Top Gainers", lines: d.gainers.map(cardLine), empty: "No card went up this week." },
    { title: "Top Losers", lines: d.losers.map(cardLine), empty: "No card went down this week." },
    { title: "Sold This Week", lines: d.sold.map(soldLine), empty: "Nothing sold this week." },
    { title: `Listed ${30}+ Days`, lines: d.stale.map(staleLine) },
  ].filter((s) => s.lines.length > 0 || s.empty);

  const text = [
    headline,
    `${d.held} card${d.held === 1 ? "" : "s"} in your collection.`,
    ...(d.leftOut ? [leftOutNote] : []),
    "",
    ...sections.flatMap((s) => [s.title.toUpperCase(), ...(s.lines.length ? s.lines.map((l) => "· " + l) : [s.empty!]), ""]),
    `Your collection: ${site}/app/collection`,
    "",
    "Prices refresh once a day. This digest goes out every Sunday.",
    `Stop these emails: ${unsubUrl}`,
    "",
    "— CardFlip · support@cardflip.io",
  ].join("\n");
  const html = `
    <p style="font-size:18px;font-weight:700;margin:0 0 4px">${esc(headline)}</p>
    <p style="color:#666;margin:0 0 16px">${d.held} card${d.held === 1 ? "" : "s"} in your collection.${leftOutNote ? ` ${esc(leftOutNote)}` : ""}</p>
    ${sections
      .map(
        (s) => `<p style="font-weight:600;margin:16px 0 4px">${esc(s.title)}</p>${
          s.lines.length ? `<ul style="margin:0;padding-left:18px">${s.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : `<p style="color:#666;margin:0">${esc(s.empty!)}</p>`
        }`,
      )
      .join("")}
    <p style="margin:20px 0"><a href="${site}/app/collection" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">Open your collection</a></p>
    <p style="color:#666;font-size:13px">Prices refresh once a day. This digest goes out every Sunday. <a href="${unsubUrl}" style="color:#666">Stop these emails</a>.</p>
    <p style="color:#999;font-size:12px">— CardFlip · support@cardflip.io</p>`;
  await transport().sendMail({
    from: fromAddress(),
    to,
    subject: `Your CardFlip week: ${usd(d.valueNow)} (${signed(change)})`,
    text,
    html,
    headers: { "List-Unsubscribe": `<${unsubUrl}>` },
  });
}

/**
 * The welcome (Chris, 09-25: the site welcomes a new user; the subscription
 * mail below is a different moment). Goes out at signup while email
 * confirmation is off, and right after the address is confirmed while it is
 * on (emailVerify.ts), never before, so it only ever reaches a proven inbox.
 * `trialLeft` is the account's free scans left: a repeat signup on a shared
 * device or IP starts with none, and must not be promised any. The first name
 * is user-typed, so it is escaped in the HTML. A mail failure never fails the
 * caller.
 */
export async function sendSignupWelcomeEmail(to: string, firstName: string, trialLeft: number = PRICING.trial.scans): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip.io";
  const scanUrl = `${site}/app`;
  const pricingUrl = `${site}/pricing`;
  const first = firstName.replace(/[\r\n]+/g, " ").trim();
  const hi = first ? `Welcome to CardFlip, ${first}.` : "Welcome to CardFlip.";
  const free = trialLeft > 0;
  const freeLine = `Your first ${trialLeft} scan${trialLeft === 1 ? " is" : "s are"} free. `;
  const how = "Point your phone camera at a card and CardFlip names it, prices it, and drafts the eBay listing";
  const plans = `A ${PRICE.pack} Scan Pack of ${SCANS.pack} scans, or ${SCANS.standard} scans a month for ${PRICE.standard}`;
  const text = [
    hi,
    "",
    free ? `${freeLine}${how}:` : `${how}:`,
    free ? scanUrl : pricingUrl,
    "",
    `${free ? "Want more?" : "To start scanning, pick one."} ${plans}: ${pricingUrl}`,
    "",
    "Questions? Tap Help in the app.",
    "",
    "— CardFlip · support@cardflip.io",
  ].join("\n");
  const html = `
    <p>${esc(hi)}</p>
    <p>${free ? freeLine : ""}${how}.</p>
    <p><a href="${free ? scanUrl : pricingUrl}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">${free ? "Scan Your First Card" : "Pick a Plan"}</a></p>
    <p style="color:#666;font-size:13px">${free ? "Want more?" : "To start scanning, pick one."} <a href="${pricingUrl}">${plans}</a>.</p>
    <p style="color:#666;font-size:13px">Questions? Tap Help in the app.</p>
    <p style="color:#999;font-size:12px">— CardFlip · support@cardflip.io</p>`;
  await transport().sendMail({
    from: fromAddress(),
    to,
    subject: first ? `Welcome to CardFlip, ${first}` : "Welcome to CardFlip",
    text,
    html,
  });
}

/**
 * Sent once, from the Stripe webhook, when a checkout completes. The webhook
 * swallows failures — a missed welcome must never make Stripe retry the event.
 */
export async function sendWelcomeEmail(to: string, plan: "standard" | "pro" = "standard"): Promise<void> {
  const included = plan === "pro" ? SCANS.pro : SCANS.standard;
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip.io";
  const scanUrl = `${site}/app`;
  const accountUrl = `${site}/app/account`;
  const text = [
    "Your CardFlip subscription is active.",
    "",
    `Each monthly payment adds ${included} scans. Point the camera at a card and CardFlip reads it, prices it, and drafts the eBay listing:`,
    scanUrl,
    "",
    `${ROLLOVER_SENTENCE} ${FROZEN_SENTENCE} Manage or cancel any time: ${accountUrl}`,
    "",
    "Questions? Reply to this email.",
    "",
    "— CardFlip · support@cardflip.io",
  ].join("\n");
  const html = `
    <p>Your CardFlip subscription is active.</p>
    <p>Each monthly payment adds ${included} scans. Point the camera at a card and CardFlip reads it, prices it, and drafts the eBay listing.</p>
    <p><a href="${scanUrl}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">Scan Your First Card</a></p>
    <p style="color:#666;font-size:13px">${ROLLOVER_SENTENCE} ${FROZEN_SENTENCE} Manage or cancel any time from <a href="${accountUrl}">your account</a>.</p>
    <p style="color:#666;font-size:13px">Questions? Reply to this email.</p>
    <p style="color:#999;font-size:12px">— CardFlip · support@cardflip.io</p>`;
  await transport().sendMail({
    from: fromAddress(),
    to,
    subject: "Your CardFlip subscription is active",
    text,
    html,
  });
}

export interface ErrorDigestGroup {
  source: string;
  message: string;
  count: number;
}

/**
 * Owner-only alert: the daily cron found more than the threshold of server
 * errors in the last 24h. The only alerting the site has (ARCHITECTURE.md
 * names "nobody is told when prod breaks" as the risk).
 */
export async function sendErrorDigestEmail(to: string, total: number, groups: ErrorDigestGroup[]): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip.io";
  const adminUrl = `${site}/admin/errors`;
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const text = [
    `${total} server error${total === 1 ? "" : "s"} on cardflip.io in the last 24 hours.`,
    "",
    ...groups.map((g) => `${g.count}× [${g.source}] ${g.message}`),
    "",
    `Details: ${adminUrl}`,
  ].join("\n");
  const html = `
    <p><strong>${total}</strong> server error${total === 1 ? "" : "s"} on cardflip.io in the last 24 hours.</p>
    <table style="border-collapse:collapse;font-size:13px">
      ${groups
        .map(
          (g) =>
            `<tr><td style="padding:4px 10px 4px 0;text-align:right;color:#666">${g.count}×</td><td style="padding:4px 10px 4px 0;color:#999">${esc(g.source)}</td><td style="padding:4px 0">${esc(g.message)}</td></tr>`,
        )
        .join("")}
    </table>
    <p><a href="${adminUrl}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">Open the admin console</a></p>`;
  await transport().sendMail({
    from: fromAddress(),
    to,
    subject: `CardFlip: ${total} server error${total === 1 ? "" : "s"} in the last 24h`,
    text,
    html,
  });
}

/** A site that used to post just failed (socialPublish.ts alertFailures, 09-29). */
export async function sendSocialFailureEmail(
  to: string,
  failures: Array<{ label: string; error: string }>,
  /** Other wording for a failure that is not a post (the night TikTok render, 09-30). */
  opts: { intro?: string; subject?: string } = {},
): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip.io";
  const adminUrl = `${site}/admin/social`;
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const names = failures.map((f) => f.label).join(", ");
  const intro = opts.intro ?? `The social robot could not post to ${names}.`;
  const text = [
    intro,
    "",
    ...failures.map((f) => `${f.label}: ${f.error.slice(0, 300)}`),
    "",
    `Details: ${adminUrl}`,
  ].join("\n");
  const html = `
    <p>${opts.intro ? esc(opts.intro) : `The social robot could not post to <strong>${esc(names)}</strong>.`}</p>
    ${failures.map((f) => `<p><strong>${esc(f.label)}</strong><br><span style="color:#666;font-size:13px">${esc(f.error.slice(0, 300))}</span></p>`).join("")}
    <p><a href="${adminUrl}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">Open Social</a></p>`;
  await transport().sendMail({ from: fromAddress(), to, subject: opts.subject ?? `CardFlip: Social Post Failed on ${names}`, text, html });
}

/**
 * Tomorrow's three TikTok videos are built (socialTiktok.ts, 09-30): the post
 * times with each caption and a link to the hand-over card. Owner only.
 */
export async function sendTiktokReadyEmail(
  to: string,
  m: { label: string; rows: Array<{ time: string; title: string; caption: string }> },
): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip.io";
  const adminUrl = `${site}/admin/social`;
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const text = [
    `The three TikTok videos for ${m.label} are ready to post by hand.`,
    "",
    ...m.rows.flatMap((r) => [`${r.time}${r.title ? ` · ${r.title}` : ""}`, r.caption, ""]),
    `Open the videos: ${adminUrl}`,
  ].join("\n");
  const html = `
    <p>The three TikTok videos for <strong>${esc(m.label)}</strong> are ready to post by hand.</p>
    ${m.rows.map((r) => `<p><strong>${esc(r.time)}</strong>${r.title ? ` · ${esc(r.title)}` : ""}<br><span style="color:#444;font-size:13px;white-space:pre-line">${esc(r.caption)}</span></p>`).join("")}
    <p><a href="${adminUrl}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">Open Social</a></p>`;
  await transport().sendMail({ from: fromAddress(), to, subject: "Tomorrow's TikTok Videos Are Ready", text, html });
}

/** CI or the prod smoke check failed (lib/server/opsAlert.ts, 09-29). */
export async function sendOpsAlertEmail(
  to: string,
  a: { workflow: string; sha?: string; url?: string; message?: string },
): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const what = `${a.workflow} failed${a.sha ? ` on ${a.sha.slice(0, 7)}` : ""}.`;
  const text = [what, a.message ?? "", "", "Claude fixes this before the next task.", a.url ? `Run: ${a.url}` : ""].filter(Boolean).join("\n");
  const html = `
    <p><strong>${esc(what)}</strong></p>
    ${a.message ? `<p style="color:#666;font-size:13px">${esc(a.message)}</p>` : ""}
    <p>Claude fixes this before the next task.</p>
    ${a.url ? `<p><a href="${esc(a.url)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">Open the Run</a></p>` : ""}`;
  await transport().sendMail({ from: fromAddress(), to, subject: `CardFlip: ${a.workflow} Failed`, text, html });
}

/* ---------------------------------------------------------------------------
 * Support tickets (supportTickets.ts, 09-26). Three mails: the working copy
 * to the support inbox, a receipt to the seller, and "closed" to the seller.
 * The types are structural so mail.ts stays import-free of the ticket module.
 * ------------------------------------------------------------------------- */

interface TicketMail {
  number: number;
  subject: string;
  body: string;
  createdAt: number;
  /** Blob URLs of photos the seller attached (09-26). */
  images?: string[];
}

/** Photos as a text block and as linked thumbnails. */
function photosText(images: string[] | undefined): string[] {
  return images?.length ? ["", `Photos (${images.length}):`, ...images] : [];
}
function photosHtml(images: string[] | undefined): string {
  if (!images?.length) return "";
  const imgs = images
    .map((u) => `<a href="${u}" style="display:inline-block;margin:0 6px 6px 0"><img src="${u}" alt="Photo" style="max-width:220px;max-height:220px;border-radius:8px;border:1px solid #ddd"></a>`)
    .join("");
  return `<p style="font-size:12px;color:#999;margin:12px 0 4px">Photos</p><div>${imgs}</div>`;
}
interface TicketUser {
  id: string;
  name: string;
  email: string;
  plan: string | null;
  ebayConnected: boolean;
  /** Still waiting on its email code: the address is unproven, so no Reply-To points at it. */
  emailPending?: boolean;
}

const UNCONFIRMED_NOTE = "Email not confirmed yet: reply on the ticket, not by email.";

const escHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

/**
 * To support@: "SUPPORT TICKET #12 · subject". Reply-To is the seller, so a
 * plain Reply in Fastmail answers them. Account facts + the recent robot
 * transcript ride along so the human sees what the robot already tried.
 */
export async function sendSupportTicketEmail(
  to: string,
  ticket: TicketMail,
  user: TicketUser,
  transcript: { role: "user" | "assistant"; content: string }[],
): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip.io";
  const adminUrl = `${site}/admin/support`;
  const tag = `SUPPORT TICKET #${ticket.number}`;
  const facts = [
    `From: ${user.name} <${user.email}>`,
    `Plan: ${user.plan ?? "none (trial or pack)"}`,
    `eBay connected: ${user.ebayConnected ? "yes" : "no"}`,
    `User id: ${user.id}`,
    ...(user.emailPending ? [UNCONFIRMED_NOTE] : []),
  ];
  const chat = transcript.slice(-8).map((m) => `${m.role === "user" ? "Seller" : "Robot"}: ${m.content}`);
  const text = [
    `${tag} · ${ticket.subject}`,
    "",
    ticket.body,
    ...photosText(ticket.images),
    "",
    "— Account —",
    ...facts,
    ...(chat.length ? ["", "— Recent robot chat —", ...chat] : []),
    "",
    `Reply on the ticket: ${adminUrl}`,
  ].join("\n");
  const html = `
    <p style="color:#666;font-size:12px">${escHtml(tag)}</p>
    <h2 style="margin:0 0 12px">${escHtml(ticket.subject)}</h2>
    <p style="white-space:pre-wrap">${escHtml(ticket.body)}</p>
    ${photosHtml(ticket.images)}
    <hr style="border:none;border-top:1px solid #ddd;margin:16px 0">
    <p style="font-size:13px;color:#666">${facts.map(escHtml).join("<br>")}</p>
    ${chat.length ? `<p style="font-size:12px;color:#999;margin-bottom:4px">Recent robot chat</p><div style="font-size:13px;color:#555;white-space:pre-wrap">${chat.map(escHtml).join("\n")}</div>` : ""}
    <p><a href="${adminUrl}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">Open support tickets</a></p>`;
  await transport().sendMail({
    from: fromAddress(),
    to,
    replyTo: user.emailPending ? undefined : `${user.name} <${user.email}>`,
    subject: `${tag} · ${ticket.subject}`,
    text,
    html,
  });
}

/**
 * To support@: the seller added to an open ticket. Subject is "Re: SUPPORT
 * TICKET #12 · subject" so it threads under the original in the inbox.
 */
export async function sendSupportTicketNoteEmail(
  to: string,
  ticket: TicketMail,
  user: TicketUser,
  note: { body: string; images: string[]; createdAt: number },
): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip.io";
  const adminUrl = `${site}/admin/support`;
  const tag = `SUPPORT TICKET #${ticket.number}`;
  const text = [
    `${tag} · ${ticket.subject} — the seller added more:`,
    "",
    note.body || "(photos only)",
    ...photosText(note.images),
    "",
    `From: ${user.name} <${user.email}>`,
    ...(user.emailPending ? [UNCONFIRMED_NOTE] : []),
    `Reply on the ticket: ${adminUrl}`,
  ].join("\n");
  const html = `
    <p style="color:#666;font-size:12px">${escHtml(tag)} · the seller added more</p>
    <h2 style="margin:0 0 12px">${escHtml(ticket.subject)}</h2>
    <p style="white-space:pre-wrap">${escHtml(note.body || "(photos only)")}</p>
    ${photosHtml(note.images)}
    <hr style="border:none;border-top:1px solid #ddd;margin:16px 0">
    <p style="font-size:13px;color:#666">From: ${escHtml(user.name)} &lt;${escHtml(user.email)}&gt;</p>
    <p><a href="${adminUrl}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">Open support tickets</a></p>`;
  await transport().sendMail({
    from: fromAddress(),
    to,
    replyTo: user.emailPending ? undefined : `${user.name} <${user.email}>`,
    subject: `Re: ${tag} · ${ticket.subject}`,
    text,
    html,
  });
}

/** To the seller: we have it, here is your number. */
export async function sendSupportTicketReceiptEmail(to: string, ticket: TicketMail): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip.io";
  const helpUrl = `${site}/app/help`;
  const tag = `SUPPORT TICKET #${ticket.number}`;
  const text = [
    `We received your support ticket. It's #${ticket.number}.`,
    "",
    `Subject: ${ticket.subject}`,
    "",
    "A human at CardFlip reads every ticket and replies on it, usually within 24 hours. We email you when they do.",
    `Open your ticket to add more or send photos: ${helpUrl}`,
    "",
    "— CardFlip · support@cardflip.io",
  ].join("\n");
  const html = `
    <p>We received your support ticket. It's <strong>#${ticket.number}</strong>.</p>
    <p style="color:#444"><strong>Subject:</strong> ${escHtml(ticket.subject)}</p>
    <p>A human at CardFlip reads every ticket and replies on it, usually within 24 hours. We email you when they do.</p>
    <p><a href="${helpUrl}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">Open Your Ticket</a></p>
    <p style="color:#666;font-size:13px">Add more or send photos any time from your ticket at <a href="${helpUrl}" style="color:#6d5dfc">${site}/app/help</a> (Support Tickets tab).</p>
    <p style="color:#999;font-size:12px">— CardFlip · support@cardflip.io</p>`;
  await transport().sendMail({ from: fromAddress(), to, subject: `${tag} · Received`, text, html });
}

/**
 * To the seller: CardFlip replied on their ticket. The answer rides along so
 * they can read it without signing in; the button opens the thread to
 * continue. Subject "SUPPORT TICKET #12 · You Received a Reply" (Chris 09-26).
 */
export async function sendSupportTicketReplyEmail(
  to: string,
  ticket: TicketMail,
  reply: { body: string; images: string[]; createdAt: number },
): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip.io";
  const helpUrl = `${site}/app/help`;
  const tag = `SUPPORT TICKET #${ticket.number}`;
  const text = [
    `CardFlip replied on your support ticket #${ticket.number}.`,
    "",
    `Subject: ${ticket.subject}`,
    "",
    reply.body || "(photos only)",
    ...photosText(reply.images),
    "",
    `Reply or add photos from your ticket: ${helpUrl}`,
    "",
    "— CardFlip · support@cardflip.io",
  ].join("\n");
  const html = `
    <p style="color:#666;font-size:12px">${escHtml(tag)}</p>
    <h2 style="margin:0 0 12px">${escHtml(ticket.subject)}</h2>
    <p style="color:#444">CardFlip replied on your support ticket <strong>#${ticket.number}</strong>:</p>
    <div style="padding:12px 16px;border-left:3px solid #6d5dfc;background:#f6f5ff;border-radius:8px;white-space:pre-wrap">${escHtml(reply.body || "(photos only)")}</div>
    ${photosHtml(reply.images)}
    <p><a href="${helpUrl}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">Open Your Ticket</a></p>
    <p style="color:#666;font-size:13px">Reply or add photos from your ticket at <a href="${helpUrl}" style="color:#6d5dfc">${site}/app/help</a> (Support Tickets tab).</p>
    <p style="color:#999;font-size:12px">— CardFlip · support@cardflip.io</p>`;
  await transport().sendMail({ from: fromAddress(), to, subject: `${tag} · You Received a Reply`, text, html });
}

/** To the seller: closed. */
export async function sendSupportTicketClosedEmail(to: string, ticket: TicketMail): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip.io";
  const tag = `SUPPORT TICKET #${ticket.number}`;
  const text = [
    `Your support ticket #${ticket.number} is closed.`,
    "",
    `Subject: ${ticket.subject}`,
    "",
    `If you still need help, open a new ticket at ${site}/app/help.`,
    "",
    "— CardFlip · support@cardflip.io",
  ].join("\n");
  const html = `
    <p>Your support ticket <strong>#${ticket.number}</strong> is closed.</p>
    <p style="color:#444"><strong>Subject:</strong> ${escHtml(ticket.subject)}</p>
    <p style="color:#666;font-size:13px">If you still need help, open a new ticket at <a href="${site}/app/help" style="color:#6d5dfc">${site}/app/help</a>.</p>
    <p style="color:#999;font-size:12px">— CardFlip · support@cardflip.io</p>`;
  await transport().sendMail({ from: fromAddress(), to, subject: `${tag} · Closed`, text, html });
}
