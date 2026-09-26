import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { isMailConfigured, sendSupportTicketClosedEmail, sendSupportTicketEmail, sendSupportTicketReceiptEmail } from "@/lib/server/mail";
import type { User } from "@/lib/server/users";

/**
 * Support tickets (Chris 09-26): the robot accepts and manages them. Opening
 * one mails support@cardflip.io as "SUPPORT TICKET #12 · subject" with the
 * seller's account facts and their last few chat turns, reply-to set to the
 * seller so Chris answers by hitting Reply in Fastmail. The seller sees the
 * number and status in the robot ("My tickets"); Chris closes from
 * /admin/support (or tells Claude). Two statuses only: open ("In progress")
 * and closed.
 */

export type TicketStatus = "open" | "closed";
export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = { open: "In progress", closed: "Closed" };
export const TICKET_SUBJECT_MAX = 80;
export const TICKET_BODY_MAX = 2000;
/** A seller can have this many open at once; the rest is spam or a loop. */
export const OPEN_TICKETS_PER_USER = 5;
export const SUPPORT_INBOX = process.env.SUPPORT_INBOX ?? "support@cardflip.io";

export interface Ticket {
  id: string;
  number: number;
  userId: string;
  subject: string;
  body: string;
  status: TicketStatus;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
}

/** Admin list rows carry who opened it. */
export interface TicketWithUser extends Ticket {
  userName: string;
  userEmail: string;
}

interface Row {
  id: string;
  number: number;
  user_id: string;
  subject: string;
  body: string;
  status: string;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  user_name?: string;
  user_email?: string;
}

function fromRow(r: Row): Ticket {
  return {
    id: r.id,
    number: Number(r.number),
    userId: r.user_id,
    subject: r.subject,
    body: r.body,
    status: r.status === "closed" ? "closed" : "open",
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    closedAt: r.closed_at == null ? null : Number(r.closed_at),
  };
}

export class TicketLimitError extends Error {}
export class TicketInputError extends Error {}

/** Numbering starts here (Chris 09-26): #2 and #3 read like nobody uses the site. */
export const FIRST_TICKET_NUMBER = 1000;

/** "SUPPORT TICKET #12 · Can't publish" — the mail subject and the chat label. */
export function ticketTag(t: Pick<Ticket, "number">): string {
  return `SUPPORT TICKET #${t.number}`;
}

export interface OpenTicketDeps {
  /** Test seam: the three mails, in order (support copy, receipt). */
  mail?: {
    support: typeof sendSupportTicketEmail;
    receipt: typeof sendSupportTicketReceiptEmail;
  };
}

/**
 * Open a ticket. `transcript` is the seller's recent robot chat (newest last),
 * included in the support mail so Chris sees what the robot already said.
 * Mail failures never lose the ticket: the row is written first and the
 * error is logged; Chris still sees it on /admin/support.
 */
export async function openTicket(
  user: User,
  input: { subject: string; body: string },
  transcript: { role: "user" | "assistant"; content: string }[] = [],
  deps: OpenTicketDeps = {},
): Promise<Ticket> {
  const body = input.body.trim().slice(0, TICKET_BODY_MAX);
  if (!body) throw new TicketInputError("Tell us what's wrong first.");
  const subject = (input.subject.trim() || body.split("\n")[0]).slice(0, TICKET_SUBJECT_MAX);
  const open = (await db
    .prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE user_id = ? AND status = 'open'")
    .get(user.id)) as { n: number } | undefined;
  if (Number(open?.n ?? 0) >= OPEN_TICKETS_PER_USER) {
    throw new TicketLimitError(`You already have ${OPEN_TICKETS_PER_USER} tickets in progress. We'll get to them.`);
  }

  const id = randomUUID();
  const now = Date.now();
  // Numbering inside the transaction so two sellers never share a number.
  const number = await db.transaction(async (tx) => {
    const row = (await tx.prepare(`SELECT COALESCE(MAX(number), ${FIRST_TICKET_NUMBER - 1}) + 1 AS n FROM support_tickets`).get()) as { n: number };
    const n = Number(row.n);
    await tx
      .prepare("INSERT INTO support_tickets (id, number, user_id, subject, body, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)")
      .run(id, n, user.id, subject, body, now, now);
    return n;
  });
  const ticket: Ticket = { id, number, userId: user.id, subject, body, status: "open", createdAt: now, updatedAt: now, closedAt: null };

  const mail = deps.mail ?? { support: sendSupportTicketEmail, receipt: sendSupportTicketReceiptEmail };
  if (deps.mail || isMailConfigured()) {
    try {
      await mail.support(SUPPORT_INBOX, ticket, user, transcript);
    } catch (err) {
      console.error(`[tickets] support mail failed for #${number}:`, err);
    }
    try {
      await mail.receipt(user.email, ticket);
    } catch (err) {
      console.error(`[tickets] receipt mail failed for #${number}:`, err);
    }
  }
  return ticket;
}

/** The seller's own tickets, newest first. */
export async function listUserTickets(userId: string, limit = 50): Promise<Ticket[]> {
  const rows = (await db
    .prepare("SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(userId, limit)) as unknown as Row[];
  return rows.map(fromRow);
}

export async function openTicketCount(userId: string): Promise<number> {
  const row = (await db
    .prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE user_id = ? AND status = 'open'")
    .get(userId)) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/** Admin: every ticket (open first, then newest), with who opened it. */
export async function listAllTickets(limit = 200): Promise<TicketWithUser[]> {
  const rows = (await db
    .prepare(
      `SELECT t.*, u.name AS user_name, u.email AS user_email FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       ORDER BY CASE t.status WHEN 'open' THEN 0 ELSE 1 END, t.created_at DESC LIMIT ?`,
    )
    .all(limit)) as unknown as Row[];
  return rows.map((r) => ({ ...fromRow(r), userName: r.user_name ?? "", userEmail: r.user_email ?? "" }));
}

export async function getTicket(id: string): Promise<TicketWithUser | null> {
  const r = (await db
    .prepare("SELECT t.*, u.name AS user_name, u.email AS user_email FROM support_tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?")
    .get(id)) as Row | undefined;
  return r ? { ...fromRow(r), userName: r.user_name ?? "", userEmail: r.user_email ?? "" } : null;
}

/**
 * Close or reopen. Closing mails the seller "ticket #N closed" (they asked
 * for a status they can trust; silence reads as forgotten). Idempotent.
 */
export async function setTicketStatus(
  id: string,
  status: TicketStatus,
  deps: { closedMail?: typeof sendSupportTicketClosedEmail } = {},
): Promise<TicketWithUser | null> {
  const before = await getTicket(id);
  if (!before) return null;
  if (before.status === status) return before;
  const now = Date.now();
  await db
    .prepare("UPDATE support_tickets SET status = ?, updated_at = ?, closed_at = ? WHERE id = ?")
    .run(status, now, status === "closed" ? now : null, id);
  const after = { ...before, status, updatedAt: now, closedAt: status === "closed" ? now : null };
  if (status === "closed" && (deps.closedMail || isMailConfigured())) {
    try {
      await (deps.closedMail ?? sendSupportTicketClosedEmail)(before.userEmail, after);
    } catch (err) {
      console.error(`[tickets] closed mail failed for #${after.number}:`, err);
    }
  }
  return after;
}
