import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  isMailConfigured,
  sendSupportTicketClosedEmail,
  sendSupportTicketEmail,
  sendSupportTicketNoteEmail,
  sendSupportTicketReceiptEmail,
  sendSupportTicketReplyEmail,
} from "@/lib/server/mail";
import { findUserById, needsEmailConfirm, type User } from "@/lib/server/users";
import { sendPushToUser } from "@/lib/server/push";
import { ticketReplyPush } from "@/lib/pushMessages";
import { isOwnBlobUrl } from "@/lib/server/ownBlob";

/**
 * Support tickets (Chris 09-26): the robot accepts and manages them, and the
 * conversation lives on the site, not in email. Opening one mails
 * support@cardflip.io as "SUPPORT TICKET #12 · subject" (the alert) and the
 * seller a receipt. The ticket is then a chat: the seller adds notes and
 * photos from Help → Support Tickets; Chris opens the same thread on
 * /admin/support and replies there, which mails the seller "SUPPORT TICKET
 * #12 · You Received a Reply" with the answer. Closing from the admin page
 * ends it for both sides (closed is closed). Two statuses only: open ("In
 * progress") and closed.
 */

export type TicketStatus = "open" | "closed";
export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = { open: "In progress", closed: "Closed" };
export const TICKET_SUBJECT_MAX = 80;
export const TICKET_BODY_MAX = 2000;
/** A seller can have this many open at once (Chris 09-26: 3); the rest is spam or a loop. */
export const OPEN_TICKETS_PER_USER = 3;
/** Photos per ticket and per note. */
export const TICKET_IMAGES_MAX = 4;
/** Notes per ticket: room for a real back-and-forth, not a firehose. */
export const TICKET_NOTES_MAX = 20;
export const SUPPORT_INBOX = process.env.SUPPORT_INBOX ?? "support@cardflip.io";
/** Only our own Blob store, only the tickets folder (the upload route writes there). */
export const TICKET_IMAGE_URL_RE = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/tickets\/[A-Za-z0-9._-]+$/;

export interface Ticket {
  id: string;
  number: number;
  userId: string;
  subject: string;
  body: string;
  images: string[];
  status: TicketStatus;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
}

export type NoteAuthor = "seller" | "admin";

/** One turn in the ticket's chat: the seller adding more, or CardFlip replying. */
export interface TicketNote {
  id: string;
  ticketId: string;
  author: NoteAuthor;
  body: string;
  images: string[];
  createdAt: number;
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
  images?: string | null;
  status: string;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  user_name?: string;
  user_email?: string;
}

interface NoteRow {
  id: string;
  ticket_id: string;
  author?: string | null;
  body: string;
  images: string | null;
  created_at: number;
}

function parseImages(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.filter((u): u is string => typeof u === "string") : [];
  } catch {
    return [];
  }
}

function fromRow(r: Row): Ticket {
  return {
    id: r.id,
    number: Number(r.number),
    userId: r.user_id,
    subject: r.subject,
    body: r.body,
    images: parseImages(r.images),
    status: r.status === "closed" ? "closed" : "open",
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    closedAt: r.closed_at == null ? null : Number(r.closed_at),
  };
}

function noteFromRow(r: NoteRow): TicketNote {
  return {
    id: r.id,
    ticketId: r.ticket_id,
    author: r.author === "admin" ? "admin" : "seller",
    body: r.body,
    images: parseImages(r.images),
    createdAt: Number(r.created_at),
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

/** Keep only our Blob URLs, deduped, capped. Anything else is dropped, not an error. */
export function cleanImages(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const u of input) {
    if (typeof u === "string" && TICKET_IMAGE_URL_RE.test(u) && isOwnBlobUrl(u) && !out.includes(u)) out.push(u);
    if (out.length >= TICKET_IMAGES_MAX) break;
  }
  return out;
}

export interface OpenTicketDeps {
  /** Test seam: the mails, in order (support copy, receipt). */
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
  input: { subject: string; body: string; images?: unknown },
  transcript: { role: "user" | "assistant"; content: string }[] = [],
  deps: OpenTicketDeps = {},
): Promise<Ticket> {
  const body = input.body.trim().slice(0, TICKET_BODY_MAX);
  const images = cleanImages(input.images);
  if (!body && images.length === 0) throw new TicketInputError("Tell us what's wrong first.");
  const subject = (input.subject.trim() || body.split("\n")[0] || "Photos").slice(0, TICKET_SUBJECT_MAX);
  if ((await openTicketCount(user.id)) >= OPEN_TICKETS_PER_USER) {
    throw new TicketLimitError(`You already have ${OPEN_TICKETS_PER_USER} tickets in progress. Add to one of those instead.`);
  }

  const id = randomUUID();
  const now = Date.now();
  // Numbering inside the transaction so two sellers never share a number.
  const number = await db.transaction(async (tx) => {
    const row = (await tx.prepare("SELECT COALESCE(MAX(number), 0) + 1 AS n FROM support_tickets").get()) as { n: number };
    // Never below the floor, even with the pre-1000 test tickets in the table
    // (09-26: #1 existed, so "COALESCE(MAX, 999) + 1" handed out #2).
    const n = Math.max(Number(row.n), FIRST_TICKET_NUMBER);
    await tx
      .prepare(
        "INSERT INTO support_tickets (id, number, user_id, subject, body, images, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)",
      )
      .run(id, n, user.id, subject, body, JSON.stringify(images), now, now);
    return n;
  });
  const ticket: Ticket = { id, number, userId: user.id, subject, body, images, status: "open", createdAt: now, updatedAt: now, closedAt: null };

  const mail = deps.mail ?? { support: sendSupportTicketEmail, receipt: sendSupportTicketReceiptEmail };
  if (deps.mail || isMailConfigured()) {
    try {
      await mail.support(SUPPORT_INBOX, ticket, user, transcript);
    } catch (err) {
      console.error(`[tickets] support mail failed for #${number}:`, err);
    }
    // No mail to an address nobody has proven yet (a signup still waiting on
    // its email code): the ticket, the thread and the phone banner are on the site.
    if (!needsEmailConfirm(user)) {
      try {
        await mail.receipt(user.email, ticket);
      } catch (err) {
        console.error(`[tickets] receipt mail failed for #${number}:`, err);
      }
    }
  }
  return ticket;
}

/** True while the ticket's owner has not proven their inbox: their address gets no support mail. */
async function sellerUnconfirmed(userId: string): Promise<boolean> {
  const seller = await findUserById(userId);
  return seller ? needsEmailConfirm(seller) : false;
}

async function insertNote(ticketId: string, sellerId: string, author: NoteAuthor, body: string, images: string[]): Promise<TicketNote> {
  const note: TicketNote = { id: randomUUID(), ticketId, author, body, images, createdAt: Date.now() };
  await db
    .prepare("INSERT INTO support_ticket_notes (id, ticket_id, user_id, author, body, images, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(note.id, ticketId, sellerId, author, body, JSON.stringify(images), note.createdAt);
  await db.prepare("UPDATE support_tickets SET updated_at = ? WHERE id = ?").run(note.createdAt, ticketId);
  return note;
}

/**
 * The seller adds to their own open ticket. Mails support@ as a reply in
 * the thread so Chris knows there is something new to read on the site.
 * Closed tickets refuse (Chris: "closed tickets are closed").
 */
export async function addTicketNote(
  user: User,
  ticketId: string,
  input: { body: string; images?: unknown },
  deps: { noteMail?: typeof sendSupportTicketNoteEmail } = {},
): Promise<TicketNote> {
  const ticket = await getUserTicket(user.id, ticketId);
  if (!ticket) throw new TicketInputError("That ticket isn't yours or doesn't exist.");
  if (ticket.status !== "open") throw new TicketInputError("That ticket is closed. Open a new one if you still need help.");
  const body = input.body.trim().slice(0, TICKET_BODY_MAX);
  const images = cleanImages(input.images);
  if (!body && images.length === 0) throw new TicketInputError("Write something or add a photo first.");
  // The cap is on the seller's side of the chat; replies never lock them out.
  if (ticket.notes.filter((n) => n.author === "seller").length >= TICKET_NOTES_MAX) {
    throw new TicketLimitError("This ticket has all the messages it can take. Wait for a reply, or open a new ticket.");
  }

  const note = await insertNote(ticketId, user.id, "seller", body, images);
  if (deps.noteMail || isMailConfigured()) {
    try {
      await (deps.noteMail ?? sendSupportTicketNoteEmail)(SUPPORT_INBOX, ticket, user, note);
    } catch (err) {
      console.error(`[tickets] note mail failed for #${ticket.number}:`, err);
    }
  }
  return note;
}

/**
 * Chris replies on the ticket from /admin/support. The reply joins the
 * thread the seller sees in Help, and the seller gets "SUPPORT TICKET #n ·
 * You Received a Reply" with the answer in it. Closed tickets refuse; reopen
 * first. Returns null when the ticket does not exist.
 */
export async function replyToTicket(
  ticketId: string,
  input: { body: string; images?: unknown },
  deps: { replyMail?: typeof sendSupportTicketReplyEmail; push?: typeof sendPushToUser } = {},
): Promise<TicketNote | null> {
  const ticket = await getTicket(ticketId);
  if (!ticket) return null;
  if (ticket.status !== "open") throw new TicketInputError("That ticket is closed. Reopen it to reply.");
  const body = input.body.trim().slice(0, TICKET_BODY_MAX);
  const images = cleanImages(input.images);
  if (!body && images.length === 0) throw new TicketInputError("Write something or add a photo first.");

  const note = await insertNote(ticketId, ticket.userId, "admin", body, images);
  if ((deps.replyMail || isMailConfigured()) && !(await sellerUnconfirmed(ticket.userId))) {
    try {
      await (deps.replyMail ?? sendSupportTicketReplyEmail)(ticket.userEmail, ticket, note);
    } catch (err) {
      console.error(`[tickets] reply mail failed for #${ticket.number}:`, err);
    }
  }
  // Phone banner too (Tier 2 #9); never throws.
  await (deps.push ?? sendPushToUser)(ticket.userId, ticketReplyPush(ticket, body));
  return note;
}

export async function listTicketNotes(ticketId: string): Promise<TicketNote[]> {
  const rows = (await db
    .prepare("SELECT * FROM support_ticket_notes WHERE ticket_id = ? ORDER BY created_at ASC, rowid ASC")
    .all(ticketId)) as unknown as NoteRow[];
  return rows.map(noteFromRow);
}

/** Notes for many tickets in one query, keyed by ticket id. */
async function notesByTicket(ticketIds: string[]): Promise<Map<string, TicketNote[]>> {
  const map = new Map<string, TicketNote[]>();
  if (ticketIds.length === 0) return map;
  const rows = (await db
    .prepare(`SELECT * FROM support_ticket_notes WHERE ticket_id IN (${ticketIds.map(() => "?").join(",")}) ORDER BY created_at ASC, rowid ASC`)
    .all(...ticketIds)) as unknown as NoteRow[];
  for (const r of rows) {
    const n = noteFromRow(r);
    map.set(n.ticketId, [...(map.get(n.ticketId) ?? []), n]);
  }
  return map;
}

/** The seller's own tickets, newest first. */
export async function listUserTickets(userId: string, limit = 50): Promise<Ticket[]> {
  const rows = (await db
    .prepare("SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC, number DESC LIMIT ?")
    .all(userId, limit)) as unknown as Row[];
  return rows.map(fromRow);
}

/** One of the seller's tickets with its notes, or null if it isn't theirs. */
export async function getUserTicket(userId: string, id: string): Promise<(Ticket & { notes: TicketNote[] }) | null> {
  const r = (await db.prepare("SELECT * FROM support_tickets WHERE id = ? AND user_id = ?").get(id, userId)) as Row | undefined;
  if (!r) return null;
  return { ...fromRow(r), notes: await listTicketNotes(id) };
}

export async function openTicketCount(userId: string): Promise<number> {
  const row = (await db
    .prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE user_id = ? AND status = 'open'")
    .get(userId)) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/** Admin: every ticket (open first, then newest), with who opened it and their notes. */
export async function listAllTickets(limit = 200): Promise<(TicketWithUser & { notes: TicketNote[] })[]> {
  const rows = (await db
    .prepare(
      `SELECT t.*, u.name AS user_name, u.email AS user_email FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       ORDER BY CASE t.status WHEN 'open' THEN 0 ELSE 1 END, t.created_at DESC, t.number DESC LIMIT ?`,
    )
    .all(limit)) as unknown as Row[];
  const notes = await notesByTicket(rows.map((r) => r.id));
  return rows.map((r) => ({ ...fromRow(r), userName: r.user_name ?? "", userEmail: r.user_email ?? "", notes: notes.get(r.id) ?? [] }));
}

export async function getTicket(id: string): Promise<TicketWithUser | null> {
  const r = (await db
    .prepare("SELECT t.*, u.name AS user_name, u.email AS user_email FROM support_tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?")
    .get(id)) as Row | undefined;
  return r ? { ...fromRow(r), userName: r.user_name ?? "", userEmail: r.user_email ?? "" } : null;
}

/** Admin: one ticket with its whole thread. */
export async function getTicketThread(id: string): Promise<(TicketWithUser & { notes: TicketNote[] }) | null> {
  const t = await getTicket(id);
  return t ? { ...t, notes: await listTicketNotes(id) } : null;
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
  if (status === "closed" && (deps.closedMail || isMailConfigured()) && !(await sellerUnconfirmed(before.userId))) {
    try {
      await (deps.closedMail ?? sendSupportTicketClosedEmail)(before.userEmail, after);
    } catch (err) {
      console.error(`[tickets] closed mail failed for #${after.number}:`, err);
    }
  }
  return after;
}
