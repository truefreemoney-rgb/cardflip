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

/**
 * A scan that found no card is not a scan (Chris, 10-11: "if a card can't be
 * found, then it doesn't count as a scan"). The scanner's pump decides
 * "No match found" after its catalog lookups; it then asks here to give the
 * scan back. The browser only names the scan: the server re-checks the stored
 * read against the catalog itself, so a client cannot talk itself into free
 * scans. One give-back per scan_usage row, within GIVEBACK_WINDOW_MS, only
 * the row's own account.
 */
export const GIVEBACK_WINDOW_MS = 15 * 60 * 1000;

export type GivebackReason = "refunded" | "already" | "late" | "unknown" | "found" | "no-draw";

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
 * art card (refused), a slab (refused), or a card from a game CardFlip does not
 * scan. None of these depend on anything the browser says.
 */
export function readIsEmpty(read: StoredRead): boolean {
  if (typeof read.conf === "number" && read.conf < UNREADABLE_CONFIDENCE) return true;
  if (read.kind === "token" || read.kind === "art") return true;
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
  let read: StoredRead = {};
  try {
    read = row.read ? (JSON.parse(row.read) as StoredRead) : {};
  } catch {
    read = {};
  }
  if (!readIsEmpty(read) && (await catalogHasMatch(read))) return { refunded: false, reason: "found", usage };
  // Claim the row first: two give-backs for one scan must not both pay out.
  const claimed = await db.prepare("UPDATE scan_usage SET refunded_at = ? WHERE id = ? AND refunded_at IS NULL").run(Date.now(), scanId);
  if (Number(claimed.changes ?? 0) < 1) return { refunded: false, reason: "already", usage };
  const after = await giveBackScans(user, { taken: 1, draw, usage }, 1);
  return { refunded: true, reason: "refunded", usage: after };
}
