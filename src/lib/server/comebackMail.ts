import "server-only";
import { db } from "@/lib/db";
import { SITE_URL } from "@/lib/siteUrl";
import { escapeHtml as esc } from "@/lib/server/campaignData";
import { EMAIL_CUTOFF, digestTokenFor } from "@/lib/server/digest";
import { isMailConfigured, sendCampaignEmail } from "@/lib/server/mail";
import { OWNER_EMAIL, listAllUsers, type User } from "@/lib/server/users";

/**
 * The one-off FLIPBACK come-back mail (Chris 10-16): 10 free scans for everyone who
 * joined since the first real TikTok signups (10-07 = EMAIL_CUTOFF), sent once by hand
 * from /api/admin/emails ({ comeback: "test" | "send" }). Same opt-outs as the campaigns
 * (digest_off, unconfirmed, admins); Chris's own test accounts are left out; nobody gets
 * it twice (email_sends campaign "comeback-flipback").
 */
export const COMEBACK_CAMPAIGN = "comeback-flipback";
export const COMEBACK_CODE = "FLIPBACK";
/** Chris's own accounts, not users (the owner gets a [COPY] instead). */
const SAMPLE_UNSUB = `${SITE_URL}/api/digest/unsubscribe?u=preview&t=preview&k=updates`;
const HOUSE_EMAILS = new Set(["cardflipio@gmail.com", "wageleymarketing@gmail.com", "wageleyinc@gmail.com", OWNER_EMAIL]);

export interface ComebackMail {
  subject: string;
  text: string;
  html: string;
}

export function renderComeback(firstName: string, unsubUrl: string): ComebackMail {
  const first = firstName.replace(/[\r\n]+/g, " ").trim().split(/\s+/)[0] ?? "";
  const hi = first ? `Hey ${first},` : "Hey there,";
  const link = `${SITE_URL}/app?code=${COMEBACK_CODE}`;
  const account = `${SITE_URL}/app/account`;
  const subject = "Your CardFlip code is inside: 10 scans on us";
  const text = [
    hi,
    "",
    "Okay, it's been a minute. We get it: life, binders, that one shoebox you keep meaning to go through.",
    "",
    "While you were away, CardFlip got busy:",
    "- Five games now: Pokémon, Magic, Yu-Gi-Oh!, Lorcana and One Piece",
    "- 205,000+ printings priced",
    "- A Watchlist that gives you a heads-up when a card's price moves",
    "",
    "So here's a welcome-back present: 10 scans, on us.",
    "",
    `Your code: ${COMEBACK_CODE}`,
    "",
    "Two ways to grab them:",
    `1. Tap this link and they're added for you: ${link}`,
    `2. Or open your Account page and type ${COMEBACK_CODE} in the "Have a code?" box: ${account}`,
    "",
    "No card, no catch, and they're yours to use whenever you like.",
    "",
    "Got a card you've always wondered about? The holo from 2003, the rare that's been sitting in a sleeve for years? Point your camera at it and find out what it's worth today. Worst case, it's a fun story. Best case... well. 😏",
    "",
    "Happy flipping,",
    "The CardFlip Support Team",
    "",
    `Stop these emails: ${unsubUrl}`,
  ].join("\n");
  const p = (s: string, style = "") => `<p style="margin:0 0 12px;${style}">${s}</p>`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:520px">
    ${p(esc(hi))}
    ${p("Okay, it&#39;s been a minute. We get it: life, binders, that one shoebox you keep meaning to go through.")}
    ${p("While you were away, CardFlip got busy:", "margin-bottom:4px")}
    <ul style="margin:0 0 14px;padding-left:20px">
      <li><b>Five games now:</b> Pokémon, Magic, Yu-Gi-Oh!, Lorcana and One Piece</li>
      <li><b>205,000+ printings priced</b></li>
      <li><b>A Watchlist</b> that gives you a heads-up when a card&#39;s price moves</li>
    </ul>
    ${p("So here&#39;s a welcome-back present: <b>10 scans, on us.</b>")}
    <div style="margin:0 0 14px;padding:14px;border:2px dashed #6d5dfc;border-radius:12px;text-align:center">
      <div style="font-size:12px;letter-spacing:.08em;color:#666;font-weight:700">YOUR CODE</div>
      <div style="font-size:26px;font-weight:800;letter-spacing:.12em;color:#6d5dfc">${COMEBACK_CODE}</div>
    </div>
    ${p("<b>Two ways to grab them:</b>", "margin-bottom:6px")}
    ${p(`1. Tap the button and they&#39;re added for you:`, "margin-bottom:8px")}
    <p style="margin:0 0 14px"><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:700">Add My 10 Scans</a></p>
    ${p(`2. Or open your <a href="${account}" style="color:#6d5dfc">Account page</a> and type <b>${COMEBACK_CODE}</b> in the &quot;Have a code?&quot; box.`)}
    ${p("No card, no catch, and they&#39;re yours to use whenever you like.")}
    ${p("Got a card you&#39;ve always wondered about? The holo from 2003, the rare that&#39;s been sitting in a sleeve for years? Point your camera at it and find out what it&#39;s worth today. Worst case, it&#39;s a fun story. Best case… well. 😏")}
    ${p("Happy flipping,<br><b>The CardFlip Support Team</b>")}
    <p style="color:#666;font-size:13px;margin:16px 0 4px"><a href="${unsubUrl}" style="color:#666">Stop these emails</a>.</p>
    <p style="color:#999;font-size:12px;margin:0">CardFlip · support@cardflip.io</p>
  </div>`;
  return { subject, text, html };
}

function unsubUrlFor(userId: string, token: string): string {
  return `${SITE_URL}/api/digest/unsubscribe?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}&k=updates`;
}

/** Everyone the mail goes to: joined since 10-07, confirmed, not opted out, not an admin or a house account, not mailed it yet. */
export async function comebackRecipients(): Promise<User[]> {
  const offRows = (await db.prepare("SELECT id FROM users WHERE digest_off = 1 OR email_pending = 1").all()) as unknown as Array<{ id: string }>;
  const off = new Set(offRows.map((r) => r.id));
  const sentRows = (await db
    .prepare("SELECT user_id FROM email_sends WHERE campaign = ? AND status = 'sent' AND user_id IS NOT NULL")
    .all(COMEBACK_CAMPAIGN)) as unknown as Array<{ user_id: string }>;
  const sent = new Set(sentRows.map((r) => r.user_id));
  return (await listAllUsers()).filter(
    (u) => u.role !== "admin" && !off.has(u.id) && !sent.has(u.id) && u.createdAt >= EMAIL_CUTOFF && !HOUSE_EMAILS.has(u.email.toLowerCase()),
  );
}

async function logSend(userId: string | null, email: string, status: "sent" | "failed" | "test" | "copy", error?: string): Promise<void> {
  await db
    .prepare("INSERT INTO email_sends (user_id, email, campaign, status, error, sent_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(userId, email, COMEBACK_CAMPAIGN, status, error ?? null, Date.now());
}

/** A sample to the owner only. */
export async function sendComebackTest(send = sendCampaignEmail): Promise<{ to: string; recipients: string[] }> {
  const mail = renderComeback("Chris", SAMPLE_UNSUB);
  await send(OWNER_EMAIL, { ...mail, subject: `[TEST] ${mail.subject}`, unsubUrl: SAMPLE_UNSUB });
  await logSend(null, OWNER_EMAIL, "test");
  return { to: OWNER_EMAIL, recipients: (await comebackRecipients()).map((u) => u.email) };
}

/**
 * The real send. Each person is stamped "sent" BEFORE the mail goes (audit #9: send-then-log mailed twice when the
 * log write failed); a send that throws flips the row to failed, so a rerun retries only those.
 */
export async function sendComeback(send = sendCampaignEmail, configured = isMailConfigured): Promise<{ due: number; sent: number; failed: number }> {
  if (!configured()) return { due: 0, sent: 0, failed: 0 };
  const due = await comebackRecipients();
  let sent = 0;
  let failed = 0;
  for (const user of due) {
    const token = await digestTokenFor(user.id);
    const unsub = unsubUrlFor(user.id, token);
    const mail = renderComeback(user.name ?? "", unsub);
    await logSend(user.id, user.email, "sent");
    try {
      await send(user.email, { ...mail, unsubUrl: unsub });
      sent++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      await db
        .prepare("UPDATE email_sends SET status = 'failed', error = ? WHERE user_id = ? AND campaign = ? AND status = 'sent'")
        .run(msg, user.id, COMEBACK_CAMPAIGN);
      console.error(`comeback mail to ${user.id} failed:`, err);
    }
  }
  // No owner [COPY] (Chris 10-18: no other people's mail in his inbox); the [TEST] button still sends him a sample.
  return { due: due.length, sent, failed };
}
