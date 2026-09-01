import "server-only";
import nodemailer from "nodemailer";

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

/**
 * Sent once, from the Stripe webhook, when a checkout completes. The webhook
 * swallows failures — a missed welcome must never make Stripe retry the event.
 */
export async function sendWelcomeEmail(to: string): Promise<void> {
  if (!isMailConfigured()) throw new Error("Mail isn't configured on this server");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip.io";
  const scanUrl = `${site}/app`;
  const accountUrl = `${site}/app/account`;
  const text = [
    "Your CardFlip subscription is active.",
    "",
    "You have 500 scans a month. Point the camera at a card and CardFlip reads it, prices it, and drafts the eBay listing:",
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
    <p>You have 500 scans a month. Point the camera at a card and CardFlip reads it, prices it, and drafts the eBay listing.</p>
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
