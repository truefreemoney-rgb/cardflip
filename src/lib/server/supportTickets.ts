import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  isMailConfigured,
  sendSupportTicketClosedEmail,
  sendSupportTicketEmail,
  sendSupportTicketNoteEmail,
  sendSupportTicketReceiptEmail,
} from "@/lib/server/mail";
import type { User } from "@/lib/server/users";

/**
 * Support tickets (Chris 09-26): the robot accepts and manages them. Opening
 * one mails support@cardflip.io as "SUPPORT TICKET #12 · subject" with the
 * seller's account facts and their last few chat turns, reply-to set to the
 * seller so Chris answers by hitting Reply in Fastmail. The seller sees the
 * number and status in the robot (Support Tickets tab), can open a ticket to
 * read what they sent, and can add notes and photos while it is open (closed
 * is closed). Chris closes from /admin/support (or tells Claude). Two
 * statuses only: open ("In progress") and closed.
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

/** A follow-up the seller added while the ticket was open. */
export interface TicketNote {
  id: string;
  ticketId: string;
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
  return { id: r.id, ticketId: r.ticket_id, body: r.body, images: parseImages(r.images), createdAt: Number(r.created_at) };
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
    if (typeof u === "string" && TICKET_IMAGE_URL_RE.test(u) && !out.includes(u)) out.push(u);
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
    try {
      await mail.receipt(user.email, ticket);
    } catch (err) {
      console.error(`[tickets] receipt mail failed for #${number}:`, err);
    }
  }
  return ticket;
}

/**
 * The seller adds to their own open ticket. Mails support@ as a reply in
 * the thread. Closed tickets refuse (Chris: "closed tickets are closed").
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
  if (ticket.notes.length >= TICKET_NOTES_MAX) throw new TicketLimitError("This ticket has all the notes it can take. Reply to the email instead.");

  const note: TicketNote = { id: randomUUID(), ticketId, body, images, createdAt: Date.now() };
  await db
    .prepare("INSERT INTO support_ticket_notes (id, ticket_id, user_id, body, images, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(note.id, ticketId, user.id, body, JSON.stringify(images), note.createdAt);
  await db.prepare("UPDATE support_tickets SET updated_at = ? WHERE id = ?").run(note.createdAt, ticketId);

  if (deps.noteMail || isMailConfigured()) {
    try {
      await (deps.noteMail ?? sendSupportTicketNoteEmail)(SUPPORT_INBOX, ticket, user, note);
    } catch (err) {
      console.error(`[tickets] note mail failed for #${ticket.number}:`, err);
    }
  }
  return note;
}

export async function listTicketNotes(ticketId: string): Promise<TicketNote[]> {
  const rows = (await db
    .prepare("SELECT * FROM support_ticket_notes WHERE ticket_id = ? ORDER BY created_at ASC")
    .all(ticketId)) as unknown as NoteRow[];
  return rows.map(noteFromRow);
}

/** Notes for many tickets in one query, keyed by ticket id. */
async function notesByTicket(ticketIds: string[]): Promise<Map<string, TicketNote[]>> {
  const map = new Map<string, TicketNote[]>();
  if (ticketIds.length === 0) return map;
  const rows = (await db
    .prepare(`SELECT * FROM support_ticket_notes WHERE ticket_id IN (${ticketIds.map(() => "?").join(",")}) ORDER BY created_at ASC`)
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
    .prepare("SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
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
       ORDER BY CASE t.status WHEN 'open' THEN 0 ELSE 1 END, t.created_at DESC LIMIT ?`,
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
