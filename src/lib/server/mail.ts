import "server-only";
import nodemailer from "nodemailer";
import { PRICE, SCANS } from "@/lib/pricing";

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

function transport() {
  const host = process.env.SMTP_HOST!;
  const port = Number(process.env.SMTP_PORT ?? 465);
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    connectionTimeout: 10000,
  });
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

/**
 * Sent right after signup (Chris, 09-25: the site welcomes a new user; the
 * subscription mail below is a different moment). Fire-and-forget from the
 * signup route: a mail failure never fails the signup.
 */
export async function sendSignupWelcomeEmail(to: string, firstName: string): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip.io";
  const scanUrl = `${site}/app`;
  const pricingUrl = `${site}/pricing`;
  const hi = firstName ? `Welcome to CardFlip, ${firstName}.` : "Welcome to CardFlip.";
  const text = [
    hi,
    "",
    `Your first ${SCANS.trial} scans are free. Point your phone camera at a card and CardFlip names it, prices it, and drafts the eBay listing:`,
    scanUrl,
    "",
    `Want more? A ${PRICE.pack} Scan Pack of ${SCANS.pack} scans, or ${SCANS.standard} scans a month for ${PRICE.standard}: ${pricingUrl}`,
    "",
    "Questions? Reply to this email.",
    "",
    "— CardFlip · support@cardflip.io",
  ].join("\n");
  const html = `
    <p>${hi}</p>
    <p>Your first ${SCANS.trial} scans are free. Point your phone camera at a card and CardFlip names it, prices it, and drafts the eBay listing.</p>
    <p><a href="${scanUrl}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">Scan your first card</a></p>
    <p style="color:#666;font-size:13px">Want more? <a href="${pricingUrl}">A ${PRICE.pack} Scan Pack of ${SCANS.pack} scans, or ${SCANS.standard} scans a month for ${PRICE.standard}</a>.</p>
    <p style="color:#666;font-size:13px">Questions? Reply to this email.</p>
    <p style="color:#999;font-size:12px">— CardFlip · support@cardflip.io</p>`;
  await transport().sendMail({
    from: fromAddress(),
    to,
    subject: firstName ? `Welcome to CardFlip, ${firstName}` : "Welcome to CardFlip",
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
    `You have ${included} scans a month. Point the camera at a card and CardFlip reads it, prices it, and drafts the eBay listing:`,
    scanUrl,
    "",
    `Scans reset each billing month. Manage or cancel any time: ${accountUrl}`,
    "",
    "Questions? Reply to this email.",
    "",
    "— CardFlip · support@cardflip.io",
  ].join("\n");
  const html = `
    <p>Your CardFlip subscription is active.</p>
    <p>You have ${included} scans a month. Point the camera at a card and CardFlip reads it, prices it, and drafts the eBay listing.</p>
    <p><a href="${scanUrl}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">Scan your first card</a></p>
    <p style="color:#666;font-size:13px">Scans reset each billing month. Manage or cancel any time from <a href="${accountUrl}">your account</a>.</p>
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
}
interface TicketUser {
  id: string;
  name: string;
  email: string;
  plan: string | null;
  ebayConnected: boolean;
}

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
  ];
  const chat = transcript.slice(-8).map((m) => `${m.role === "user" ? "Seller" : "Robot"}: ${m.content}`);
  const text = [
    `${tag} · ${ticket.subject}`,
    "",
    ticket.body,
    "",
    "— Account —",
    ...facts,
    ...(chat.length ? ["", "— Recent robot chat —", ...chat] : []),
    "",
    `Close it: ${adminUrl}`,
  ].join("\n");
  const html = `
    <p style="color:#666;font-size:12px">${escHtml(tag)}</p>
    <h2 style="margin:0 0 12px">${escHtml(ticket.subject)}</h2>
    <p style="white-space:pre-wrap">${escHtml(ticket.body)}</p>
    <hr style="border:none;border-top:1px solid #ddd;margin:16px 0">
    <p style="font-size:13px;color:#666">${facts.map(escHtml).join("<br>")}</p>
    ${chat.length ? `<p style="font-size:12px;color:#999;margin-bottom:4px">Recent robot chat</p><div style="font-size:13px;color:#555;white-space:pre-wrap">${chat.map(escHtml).join("\n")}</div>` : ""}
    <p><a href="${adminUrl}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">Open support tickets</a></p>`;
  await transport().sendMail({
    from: fromAddress(),
    to,
    replyTo: `${user.name} <${user.email}>`,
    subject: `${tag} · ${ticket.subject}`,
    text,
    html,
  });
}

/** To the seller: we have it, here is your number. */
export async function sendSupportTicketReceiptEmail(to: string, ticket: TicketMail): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const tag = `SUPPORT TICKET #${ticket.number}`;
  const text = [
    `We got your support ticket. It's #${ticket.number}.`,
    "",
    `Subject: ${ticket.subject}`,
    "",
    "A human reads every one and replies to this address. Reply to this email to add anything.",
    "You can see the status any time from the robot in the app: tap Help, then My tickets.",
    "",
    "— CardFlip · support@cardflip.io",
  ].join("\n");
  const html = `
    <p>We got your support ticket. It's <strong>#${ticket.number}</strong>.</p>
    <p style="color:#444"><strong>Subject:</strong> ${escHtml(ticket.subject)}</p>
    <p>A human reads every one and replies to this address. Reply to this email to add anything.</p>
    <p style="color:#666;font-size:13px">You can see the status any time from the robot in the app: tap Help, then My tickets.</p>
    <p style="color:#999;font-size:12px">— CardFlip · support@cardflip.io</p>`;
  await transport().sendMail({ from: fromAddress(), to, subject: `${tag} · we got it`, text, html });
}

/** To the seller: closed. */
export async function sendSupportTicketClosedEmail(to: string, ticket: TicketMail): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const tag = `SUPPORT TICKET #${ticket.number}`;
  const text = [
    `Your support ticket #${ticket.number} is closed.`,
    "",
    `Subject: ${ticket.subject}`,
    "",
    "If it's not actually sorted, reply to this email or open a new ticket from the robot in the app.",
    "",
    "— CardFlip · support@cardflip.io",
  ].join("\n");
  const html = `
    <p>Your support ticket <strong>#${ticket.number}</strong> is closed.</p>
    <p style="color:#444"><strong>Subject:</strong> ${escHtml(ticket.subject)}</p>
    <p style="color:#666;font-size:13px">If it's not actually sorted, reply to this email or open a new ticket from the robot in the app.</p>
    <p style="color:#999;font-size:12px">— CardFlip · support@cardflip.io</p>`;
  await transport().sendMail({ from: fromAddress(), to, subject: `${tag} · closed`, text, html });
}
