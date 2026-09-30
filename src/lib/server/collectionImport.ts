import "server-only";
import { db } from "@/lib/db";
import { parseImport, cleanName, type ImportRow } from "@/lib/importCsv";
import { searchEnglishCardsLocal, englishCardById, isFirstEditionId } from "@/lib/server/enCards";
import { latestUsdPrices } from "@/lib/server/priceHistory";
import { createCard, type CardRecord } from "@/lib/server/cards";
import { parsePrintedNumber, normalizeNumber } from "@/lib/cardNumber";
import { normalizeSetName } from "@/lib/tcgcsv";
import { classifySealedProduct } from "@/lib/sealedProducts";
import { askingPriceFor } from "@/lib/listing";
import type { PokemonCard } from "@/lib/types";

/**
 * Import from other apps (Tier 2 #12, 09-27): a Collectr / TCGplayer /
 * TCG Collector CSV becomes collection rows matched to our catalog and
 * priced at today's market — the switching cost, removed.
 *
 * Two passes over the same file: preview (nothing written; every row comes
 * back matched, doubtful, or skipped with the reason) and commit (the same
 * matching, then one card row per copy). Matching: a TCGplayer product id
 * is exact (tcgplayer_products → en_cards); otherwise name + number + set
 * through the scanner's own ranker, and the file's set name is trusted as a
 * filter, not just a tiebreak — the other app already knew the set.
 *
 * Imported rows are verified at creation (the seller's app named them), so
 * they list without the "Verify match" step; the photo rule still applies
 * before publishing. Pokémon only: Magic is admin-only.
 */

export const MAX_IMPORT_CARDS = 500;
export const MAX_CSV_BYTES = 1_000_000;

export type RowStatus = "ok" | "check" | "skip";

export interface PreviewRow {
  line: number;
  /** What the file said. */
  input: string;
  status: RowStatus;
  /** Why it is doubtful or skipped. */
  reason: string | null;
  quantity: number;
  condition: string;
  catalogCardId: string | null;
  name: string | null;
  setName: string | null;
  number: string | null;
  imageUrl: string | null;
  /** Today's asking price for the condition, 0 = unpriced yet. */
  price: number;
  paid: number | null;
  firstEdition: boolean;
}

export interface ImportPreview {
  columns: Record<string, string>;
  rows: PreviewRow[];
  /** Cards that would be created (ok + check rows × quantity). */
  cards: number;
  matched: number;
  doubtful: number;
  skipped: number;
  /** Sum of the priced rows' asking prices × quantity. */
  value: number;
  /** True when the file holds more cards than one import takes; the rest are dropped. */
  truncated: boolean;
  /** Why it was cut: the per-file cap or the seller's scan balance. */
  truncatedBy: "file" | "scans" | null;
  /** Scans left before this import (null = unlimited). Every imported card is one scan. */
  scansLeft: number | null;
}

const foldSet = (s: string) => normalizeSetName(s).replace(/\s+/g, "");
const foldName = (s: string) => s.toLowerCase().replace(/[‘’‛′`´]/g, "'").replace(/-/g, " ").replace(/\s+/g, " ").trim();

/** "match" = the same set; "loose" = one name inside the other ("Base" / "Base Set"); "no" = different. */
function setAgrees(want: string | null, have: string): "match" | "loose" | "no" {
  if (!want) return "match";
  const a = foldSet(want);
  const b = foldSet(have);
  if (!a || !b) return "match";
  if (a === b) return "match";
  // Never let "Base Set" claim "Base Set 2" through a substring — a trailing
  // digit is a different expansion.
  const digitTail = (s: string) => /\d$/.test(s);
  if (digitTail(a) !== digitTail(b)) return "no";
  return a.includes(b) || b.includes(a) ? "loose" : "no";
}

/** Candidates in the file's set: exact-name sets first, else the loose ones. */
function inSetOf<T extends { setName: string }>(want: string | null, cards: T[]): T[] {
  const exact = cards.filter((c) => setAgrees(want, c.setName) === "match");
  if (exact.length > 0) return exact;
  return cards.filter((c) => setAgrees(want, c.setName) === "loose");
}

async function catalogRow(id: string): Promise<PokemonCard | null> {
  const r = await englishCardById(id);
  return r.cards[0] ?? null;
}

async function byTcgplayerId(productId: number): Promise<PokemonCard | null> {
  const row = (await db.prepare("SELECT card_id FROM tcgplayer_products WHERE product_id = ? AND game = 'pokemon'").get(productId)) as
    | { card_id: string }
    | undefined;
  if (!row) return null;
  return catalogRow(row.card_id);
}

interface Match {
  card: PokemonCard | null;
  doubt: string | null;
}

/** One row → the catalog card it names, with a doubt when the file left room for one. */
export async function matchRow(row: ImportRow): Promise<Match> {
  if (row.tcgplayerId != null) {
    const hit = await byTcgplayerId(row.tcgplayerId);
    if (hit) return { card: hit, doubt: null };
  }
  const cleaned = cleanName(row.name, row.number);
  if (!cleaned.name) return { card: null, doubt: null };
  const printed = cleaned.number ? parsePrintedNumber(cleaned.number) : null;
  if (printed && row.setName) printed.setName = row.setName;
  const found = await searchEnglishCardsLocal(cleaned.name, printed, 40, null, row.firstEdition);
  if (found.cards.length === 0) return { card: null, doubt: null };

  const want = foldName(cleaned.name);
  const wantNum = printed ? normalizeNumber(printed.number) : null;
  const nameHit = (c: PokemonCard) => foldName(c.name) === want || (want.startsWith("basic ") && foldName(c.name) === want.slice(6));
  const numHit = (c: PokemonCard) => !wantNum || normalizeNumber(c.number) === wantNum || normalizeNumber(c.number.replace(/^[a-z]+[\s-]*/i, "")) === wantNum;
  const edition = (c: PokemonCard) => isFirstEditionId(c.id) === row.firstEdition;

  const exact = found.cards.filter((c) => nameHit(c) && numHit(c) && edition(c));
  const inSet = inSetOf(row.setName, exact);
  if (inSet.length === 1) return { card: inSet[0], doubt: null };
  if (inSet.length > 1) {
    // Same name and set, and either no number in the file or the same
    // number twice (a promo reprinted under the set's name). The ranker's
    // order stands; say why it needs a look.
    return { card: inSet[0], doubt: wantNum ? "Several printings match — check the set" : "No card number in the file — check the printing" };
  }
  if (exact.length >= 1) {
    return {
      card: exact[0],
      doubt: row.setName ? `Set "${row.setName}" not found — matched ${exact[0].setName}` : "Several printings match — check the set",
    };
  }
  // Name matched, number did not (a file with no number, or a promo number
  // written differently): only trust it when the set narrows it to one.
  const byName = inSetOf(row.setName, found.cards.filter((c) => nameHit(c) && edition(c)));
  if (byName.length === 1 && row.setName) {
    return { card: byName[0], doubt: wantNum ? `Number ${cleaned.number} not in ${byName[0].setName} — matched #${byName[0].number}` : null };
  }
  if (byName.length >= 1) return { card: byName[0], doubt: "Number didn't match — check the printing" };
  return { card: null, doubt: null };
}

function isSealedName(name: string): boolean {
  return classifySealedProduct(name) != null && /\b(box|pack|tin|bundle|collection|deck|blister|case|display|etb)\b/i.test(name);
}

function describe(row: ImportRow): string {
  return [row.name, row.setName, row.number].filter(Boolean).join(" · ");
}

/**
 * The whole file, matched and priced, nothing written. `scansLeft` is the
 * seller's scan balance: every imported card counts as one scan (Chris,
 * 09-27), so the import stops where the balance does.
 */
export async function previewImport(csv: string, scansLeft: number | null = null): Promise<ImportPreview> {
  const parsed = parseImport(csv);
  const rows: PreviewRow[] = [];
  const byScans = scansLeft != null && scansLeft < MAX_IMPORT_CARDS;
  let budget = byScans ? Math.max(0, scansLeft) : MAX_IMPORT_CARDS;
  const overReason = byScans
    ? scansLeft <= 0
      ? "You're out of scans — each imported card is one scan"
      : `Only ${scansLeft} scan${scansLeft === 1 ? "" : "s"} left — each imported card is one scan`
    : `Over the ${MAX_IMPORT_CARDS}-card limit for one import`;
  let truncated = false;

  for (const s of parsed.skipped) {
    rows.push({
      line: s.line,
      input: `Line ${s.line}`,
      status: "skip",
      reason: s.reason,
      quantity: 0,
      condition: "Near Mint",
      catalogCardId: null,
      name: null,
      setName: null,
      number: null,
      imageUrl: null,
      price: 0,
      paid: null,
      firstEdition: false,
    });
  }

  for (const row of parsed.rows) {
    const base: PreviewRow = {
      line: row.line,
      input: describe(row),
      status: "skip",
      reason: null,
      quantity: row.quantity,
      condition: row.condition ?? "Near Mint",
      catalogCardId: null,
      name: null,
      setName: null,
      number: null,
      imageUrl: null,
      price: 0,
      paid: row.paid != null && row.paid > 0 ? Math.round(row.paid * 100) / 100 : null,
      firstEdition: row.firstEdition,
    };
    if (row.game && !/pok/i.test(row.game)) {
      rows.push({ ...base, reason: "Only Pokémon imports for now" });
      continue;
    }
    if (row.language && !/^(en|english)$/i.test(row.language)) {
      rows.push({ ...base, reason: `Only English cards for now (${row.language})` });
      continue;
    }
    if (isSealedName(row.name)) {
      rows.push({ ...base, reason: "Sealed products need your own photo — add them from the scanner" });
      continue;
    }
    if (budget <= 0) {
      truncated = true;
      rows.push({ ...base, reason: overReason });
      continue;
    }
    const m = await matchRow(row);
    if (!m.card) {
      rows.push({ ...base, reason: "Not in our catalog" });
      continue;
    }
    const quantity = Math.min(row.quantity, budget);
    if (quantity < row.quantity) truncated = true;
    budget -= quantity;
    rows.push({
      ...base,
      status: m.doubt ? "check" : "ok",
      reason: m.doubt,
      quantity,
      catalogCardId: m.card.id,
      name: m.card.name,
      setName: m.card.setName,
      number: m.card.number,
      imageUrl: m.card.imageSmall,
    });
  }

  const ids = [...new Set(rows.map((r) => r.catalogCardId).filter((x): x is string => Boolean(x)))];
  const prices = ids.length ? await latestUsdPrices(ids) : new Map<string, { price: number; variant: string }>();
  let value = 0;
  for (const r of rows) {
    if (!r.catalogCardId) continue;
    const market = prices.get(r.catalogCardId)?.price ?? 0;
    r.price = market > 0 ? askingPriceFor(market, r.condition) : 0;
    value += r.price * r.quantity;
  }

  const live = rows.filter((r) => r.status !== "skip");
  return {
    columns: parsed.columns as Record<string, string>,
    rows,
    cards: live.reduce((n, r) => n + r.quantity, 0),
    matched: rows.filter((r) => r.status === "ok").length,
    doubtful: rows.filter((r) => r.status === "check").length,
    skipped: rows.filter((r) => r.status === "skip").length,
    value: Math.round(value * 100) / 100,
    truncated,
    truncatedBy: truncated ? (byScans ? "scans" : "file") : null,
    scansLeft,
  };
}

export interface ImportResult {
  created: number;
  cards: CardRecord[];
  preview: ImportPreview;
}

/** How an import pays for its cards: scans are taken BEFORE any card is written and unused ones given back (Chris, 09-30). */
export interface ImportScanHooks {
  /** Take n scans; answers how many were actually taken (n, or fewer when the balance ran short). */
  reserve: (n: number) => Promise<number>;
  /** Give n scans back: fewer cards were written than were reserved. */
  release: (n: number) => Promise<void>;
}

/**
 * Preview, then write: one card row per copy for every ok/check row.
 * `omit` = file lines the seller unticked in the review. With `scans`, the
 * cards to write are reserved first (an atomic take, so a double-submitted
 * import cannot write cards it did not pay for), only that many are written,
 * and any shortfall (a write that threw, a smaller balance) goes back.
 */
export async function commitImport(userId: string, csv: string, omit: number[] = [], scansLeft: number | null = null, scans?: ImportScanHooks): Promise<ImportResult> {
  const preview = await previewImport(csv, scansLeft);
  const skip = new Set(omit);
  const now = Date.now();
  const cards: CardRecord[] = [];
  const rows = preview.rows.filter((r) => r.status !== "skip" && !skip.has(r.line) && r.catalogCardId);
  const want = rows.reduce((n, r) => n + r.quantity, 0);
  const granted = scans && want > 0 ? Math.min(want, await scans.reserve(want)) : want;
  try {
    for (const r of rows) {
      for (let i = 0; i < r.quantity && cards.length < granted; i++) {
        cards.push(
          await createCard(userId, {
            kind: "card",
            game: "pokemon",
            cardName: r.name ?? "",
            setName: r.setName ?? "",
            cardNumber: r.number ?? "",
            imageUrl: r.imageUrl ?? "",
            condition: r.condition,
            price: r.price,
            catalogCardId: r.catalogCardId,
            verifiedAt: r.status === "ok" ? now : null,
            matchDoubt: r.status === "check" ? r.reason : null,
            costBasis: r.paid,
            firstEdition: r.firstEdition,
            category: "Imported",
          }),
        );
      }
    }
  } finally {
    if (scans && granted > cards.length) await scans.release(granted - cards.length);
  }
  return { created: cards.length, cards, preview };
}