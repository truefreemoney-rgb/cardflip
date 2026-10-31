import "server-only";
import { db } from "@/lib/db";
import { giveBackScans, scanQuota, type ScanDraw } from "@/lib/server/scanQuota";
import type { ScanQuota, User } from "@/lib/server/users";
import { searchEnglishCardsLocal } from "@/lib/server/enCards";
import { searchMtgCardsLocal } from "@/lib/server/mtgCards";
import { isTcgGame, searchTcgCardsLocal } from "@/lib/server/tcgCards";
import { parseGame } from "@/lib/games";
import type { PrintedNumber } from "@/lib/cardNumber";
import { UNREADABLE_CONFIDENCE } from "@/lib/types";
import { dayBudgetSpent } from "@/lib/server/dayBudget";

/**
 * Give-backs per account per day (10-16 audit). Each empty read is still a paid model call, so a scan-then-give-back
 * loop on one scan spent ~$5.50 a day per account with nothing to show. A real seller misses far fewer than this.
 */
export const GIVEBACK_DAILY_CAP = 20;

/**
 * A scan that found no card is not a scan (Chris, 10-11: "if a card can't be
 * found, then it doesn't count as a scan"). The scanner's pump decides
 * "No match found" after its catalog lookups; it then asks here to give the
 * scan back. The browser only names the scan: the server checks that the scan
 * saved no card (scanSavedACard, 10-30; it used to re-check the read against
 * the catalog, which refused real cards the scanner dropped), so a client
 * cannot get a card AND the scan back. One give-back per scan_usage row,
 * within GIVEBACK_WINDOW_MS, only the row's own account, capped per day.
 */
export const GIVEBACK_WINDOW_MS = 15 * 60 * 1000;

export type GivebackReason = "refunded" | "already" | "late" | "unknown" | "found" | "no-draw" | "cap";

interface UsageRow {
  id: string;
  user_id: string;
  at: number;
  read: string | null;
  draw: string | null;
  refunded_at: number | null;
}

interface StoredRead {
  game?: string;
  name?: string | null;
  number?: string | null;
  total?: number | null;
  code?: string | null;
  conf?: number | null;
  kind?: string | null;
  slab?: boolean;
  /** The game the model saw on the card, when it was not the one being scanned. */
  seen?: string | null;
}

/**
 * The model's own verdict that the seller got nothing (10-11, Chris: "forgiving
 * of bad scans, it doesn't deliver a product"): an unreadable photo, a token or
 * art card (refused), a slab or a pack/box (refused, "coming soon" after PriceCharting, Chris 10-31), or a card
 * from a game CardFlip does not scan. None of these depend on anything the browser says.
 */
export function readIsEmpty(read: StoredRead): boolean {
  if (typeof read.conf === "number" && read.conf < UNREADABLE_CONFIDENCE) return true;
  if (read.kind === "token" || read.kind === "art" || read.kind === "sealed") return true;
  if (read.slab === true) return true;
  if (read.seen && read.seen !== "other" && read.game && read.seen !== read.game) return true;
  return false;
}

/** Any catalog card for the read's name/number in its game? Errors count as "nothing found": the seller got nothing. */
export async function catalogHasMatch(read: StoredRead): Promise<boolean> {
  const name = (read.name ?? "").trim();
  const number = (read.number ?? "").trim();
  const printed: PrintedNumber | null = number
    ? { number, setTotal: typeof read.total === "number" ? read.total : null, setCode: read.code ?? null, isSecretRare: false }
    : null;
  if (!name && !printed) return false;
  const game = parseGame(read.game);
  try {
    if (game === "mtg") return (await searchMtgCardsLocal(name, number || null, read.code ?? null, 5)).length > 0;
    if (isTcgGame(game)) return (await searchTcgCardsLocal(game, name, printed, 5)).length > 0;
    return (await searchEnglishCardsLocal(name, printed, 5)).cards.length > 0;
  } catch (err) {
    console.warn("scan give-back: catalog check failed, treating as no match", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Did this scan put a card in the account? The scanner saves each card with its scan's id as client_id
 * (app/page.tsx), so a live row, or a deleted one (card_removals.client_id, logged on delete), says yes. A
 * 'save-failed' log carries the scan id as card_id and is not a card.
 */
export async function scanSavedACard(userId: string, scanId: string): Promise<boolean> {
  const live = await db.prepare("SELECT 1 FROM cards WHERE user_id = ? AND client_id = ? LIMIT 1").get(userId, scanId);
  if (live) return true;
  const gone = await db
    .prepare("SELECT 1 FROM card_removals WHERE user_id = ? AND client_id = ? AND how != 'save-failed' LIMIT 1")
    .get(userId, scanId);
  return Boolean(gone);
}

/**
 * Give one no-match scan back. `usage` is the balance after the decision
 * (unchanged when nothing was refunded) so the header counter can follow.
 */
export async function giveBackNoMatchScan(user: User, scanId: string): Promise<{ refunded: boolean; reason: GivebackReason; usage: ScanQuota }> {
  const row = (await db.prepare("SELECT id, user_id, at, read, draw, refunded_at FROM scan_usage WHERE id = ? AND user_id = ?").get(scanId, user.id)) as
    | UsageRow
    | undefined;
  const usage = scanQuota(user);
  if (!row) return { refunded: false, reason: "unknown", usage };
  if (row.refunded_at) return { refunded: false, reason: "already", usage };
  if (Date.now() - Number(row.at) > GIVEBACK_WINDOW_MS) return { refunded: false, reason: "late", usage };
  let draw: ScanDraw | null = null;
  try {
    draw = row.draw ? (JSON.parse(row.draw) as ScanDraw) : null;
  } catch {
    draw = null;
  }
  if (!draw) return { refunded: false, reason: "no-draw", usage };
  // 10-30 (Chris, after Lucas paid 5 trial scans for 1 card: "every single one needs to give a result"): the test
  // is whether this scan put a card in the account, not whether its card exists in the catalog. The old catalog
  // test refused every give-back for a real card the scanner dropped (a timeout, a closed page), so a seller paid
  // for nothing. The read is no longer consulted: an empty read saved nothing either.
  if (await scanSavedACard(user.id, scanId)) return { refunded: false, reason: "found", usage };
  if (await dayBudgetSpent(`giveback_${user.id}`, GIVEBACK_DAILY_CAP)) return { refunded: false, reason: "cap", usage };
  // Claim the row first: two give-backs for one scan must not both pay out.
  const claimed = await db.prepare("UPDATE scan_usage SET refunded_at = ? WHERE id = ? AND refunded_at IS NULL").run(Date.now(), scanId);
  if (Number(claimed.changes ?? 0) < 1) return { refunded: false, reason: "already", usage };
  let after: Awaited<ReturnType<typeof giveBackScans>>;
  try {
    after = await giveBackScans(user, { taken: 1, draw, usage }, 1);
  } catch (err) {
    // The credit failed after the claim: release it, or the scan could never be given back (review 10-19 pricing #15).
    await db.prepare("UPDATE scan_usage SET refunded_at = NULL WHERE id = ?").run(scanId).catch(() => undefined);
    throw err;
  }
  return { refunded: true, reason: "refunded", usage: after };
}

/**
 * A deleted card the scanner itself doubted gives its scan back (Chris 10-21, after a Kindle Fire buyer paid for 41
 * scans she deleted: 40% reads, wrong printings, the same Pikachu 8 times). Only cards the scanner flagged
 * (match_doubt below), never verified, deleted within DOUBT_GIVEBACK_WINDOW_MS of being saved; same per-day cap as
 * the no-match give-back, so scan-read-delete cannot become free price checks. The card has no scan id, so the scan
 * is the account's latest charged, unrefunded scan_usage row from the 3 minutes before the card was saved.
 */
export const DOUBT_GIVEBACK_WINDOW_MS = 60 * 60 * 1000;
const DOUBTED = /low-confidence read|printing swap|corrected from|looks more like this printing/i;
const SCAN_TO_SAVE_MS = 3 * 60 * 1000;

export interface DoubtedCard {
  id: string;
  createdAt: number;
}

/** Read BEFORE the delete: which of these rows qualify. Never throws (a failed check only skips the give-back). */
export async function doubtedCardsAmong(userId: string, ids: string[], now = Date.now()): Promise<DoubtedCard[]> {
  if (ids.length === 0) return [];
  try {
    const marks = ids.map(() => "?").join(", ");
    const rows = (await db
      .prepare(`SELECT id, created_at, match_doubt FROM cards WHERE user_id = ? AND status != 'sold' AND verified_at IS NULL AND match_doubt IS NOT NULL AND id IN (${marks})`)
      .all(userId, ...ids)) as { id: string; created_at: number; match_doubt: string }[];
    return rows
      .filter((r) => DOUBTED.test(r.match_doubt) && now - Number(r.created_at) <= DOUBT_GIVEBACK_WINDOW_MS)
      .map((r) => ({ id: r.id, createdAt: Number(r.created_at) }));
  } catch (err) {
    console.warn("doubt give-back: check failed", err instanceof Error ? err.message : err);
    return [];
  }
}

/** After the delete: give back one scan per doubted card. Returns how many came back. Never throws. */
export async function giveBackDoubtedDeletes(user: User, cards: DoubtedCard[]): Promise<number> {
  let refunded = 0;
  for (const card of [...cards].sort((a, b) => a.createdAt - b.createdAt)) {
    try {
      const row = (await db
        .prepare(
          "SELECT id, draw FROM scan_usage WHERE user_id = ? AND draw IS NOT NULL AND refunded_at IS NULL AND at <= ? AND at >= ? ORDER BY at DESC LIMIT 1",
        )
        .get(user.id, card.createdAt + 5_000, card.createdAt - SCAN_TO_SAVE_MS)) as { id: string; draw: string } | undefined;
      if (!row) continue;
      const draw = JSON.parse(row.draw) as ScanDraw;
      if (await dayBudgetSpent(`giveback_${user.id}`, GIVEBACK_DAILY_CAP)) break;
      const claimed = await db.prepare("UPDATE scan_usage SET refunded_at = ? WHERE id = ? AND refunded_at IS NULL").run(Date.now(), row.id);
      if (Number(claimed.changes ?? 0) < 1) continue;
      try {
        await giveBackScans(user, { taken: 1, draw, usage: scanQuota(user) }, 1);
        refunded++;
      } catch (err) {
        await db.prepare("UPDATE scan_usage SET refunded_at = NULL WHERE id = ?").run(row.id).catch(() => undefined);
        throw err;
      }
    } catch (err) {
      console.warn("doubt give-back: refund failed", err instanceof Error ? err.message : err);
    }
  }
  return refunded;
}

/**
 * The server's own safety net (10-30, Lucas): the scanner asks for a give-back when a scan ends without a card, but a
 * closed tab, a dead signal or a crash never asks, and the seller paid for nothing. Before each new scan, this hands
 * back the account's paid scans from the give-back window that are at least UNSAVED_GRACE_MS old and saved no card
 * (scanSavedACard). Same per-row claim and daily cap as every give-back. Returns how many came back.
 */
export const UNSAVED_GRACE_MS = 3 * 60 * 1000;
export async function sweepUnsavedScans(user: User, now = Date.now()): Promise<number> {
  const rows = (await db
    .prepare(
      `SELECT s.id FROM scan_usage s
       WHERE s.user_id = ? AND s.refunded_at IS NULL AND s.draw IS NOT NULL AND s.at BETWEEN ? AND ?
         AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.user_id = s.user_id AND c.client_id = s.id)
       ORDER BY s.at LIMIT 10`,
    )
    .all(user.id, now - GIVEBACK_WINDOW_MS, now - UNSAVED_GRACE_MS)) as { id: string }[];
  let back = 0;
  for (const r of rows) {
    const res = await giveBackNoMatchScan(user, r.id);
    if (res.refunded) back++;
    if (res.reason === "cap") break;
  }
  return back;
}