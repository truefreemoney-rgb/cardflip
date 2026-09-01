import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { pickPrice } from "@/lib/listing";
import type { GameId, PokemonCard, ScanLanguage } from "@/lib/types";

export interface PriceCheckEntry {
  id: string;
  userId: string;
  cardName: string;
  setName: string;
  cardNumber: string;
  language: ScanLanguage;
  representativePrice: number | null;
  prices: PokemonCard["prices"];
  checkedAt: number;
  /** Catalog id + game so the history can reopen the card. Null on old rows. */
  cardId: string | null;
  game: GameId | null;
  /** Small card image for the history thumbnail. Null on old rows. */
  imageUrl: string | null;
}

interface PriceCheckRow {
  id: string;
  user_id: string;
  card_name: string;
  set_name: string;
  card_number: string;
  language: ScanLanguage;
  representative_price: number | null;
  prices_json: string;
  checked_at: number;
  card_id: string | null;
  game: GameId | null;
  image_url: string | null;
}

function fromRow(row: PriceCheckRow): PriceCheckEntry {
  return {
    id: row.id,
    userId: row.user_id,
    cardName: row.card_name,
    setName: row.set_name,
    cardNumber: row.card_number,
    language: row.language,
    representativePrice: row.representative_price,
    prices: JSON.parse(row.prices_json),
    checkedAt: row.checked_at,
    cardId: row.card_id,
    game: row.game,
    imageUrl: row.image_url,
  };
}

/** Re-checking the same card back-to-back shouldn't stack duplicate rows —
 * refresh the existing entry instead when the last lookup of this exact card
 * is recent. (The demo account used to show 40+ identical rows.) */
const DEDUPE_WINDOW_MS = 60 * 60 * 1000;

export async function logPriceCheck(
  userId: string,
  card: PokemonCard,
  language: ScanLanguage,
): Promise<PriceCheckEntry> {
  const id = randomUUID();
  const checkedAt = Date.now();
  const representativePrice = pickPrice(card)?.market ?? null;

  const recent = (await db
    .prepare(
      `SELECT id FROM price_checks
       WHERE user_id = ? AND card_name = ? AND set_name = ? AND card_number = ? AND language = ?
         AND checked_at > ?
       ORDER BY checked_at DESC LIMIT 1`,
    )
    .get(userId, card.name, card.setName, card.number, language, checkedAt - DEDUPE_WINDOW_MS)) as
    | { id: string }
    | undefined;
  const game = card.game ?? "pokemon";
  if (recent) {
    // Re-checks also backfill card_id/game onto rows logged before those
    // columns existed.
    await db.prepare(
      "UPDATE price_checks SET representative_price = ?, prices_json = ?, checked_at = ?, card_id = ?, game = ?, image_url = ? WHERE id = ?",
    ).run(representativePrice, JSON.stringify(card.prices), checkedAt, card.id, game, card.imageSmall, recent.id);
    return {
      id: recent.id,
      userId,
      cardName: card.name,
      setName: card.setName,
      cardNumber: card.number,
      language,
      representativePrice,
      prices: card.prices,
      checkedAt,
      cardId: card.id,
      game,
      imageUrl: card.imageSmall,
    };
  }

  await db.prepare(
    `INSERT INTO price_checks
       (id, user_id, card_name, set_name, card_number, language, representative_price, prices_json, checked_at, card_id, game, image_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    card.name,
    card.setName,
    card.number,
    language,
    representativePrice,
    JSON.stringify(card.prices),
    checkedAt,
    card.id,
    game,
    card.imageSmall,
  );

  return {
    id,
    userId,
    cardName: card.name,
    setName: card.setName,
    cardNumber: card.number,
    language,
    representativePrice,
    prices: card.prices,
    checkedAt,
    cardId: card.id,
    game,
    imageUrl: card.imageSmall,
  };
}

export async function deletePriceCheck(id: string, userId: string): Promise<void> {
  await db.prepare("DELETE FROM price_checks WHERE id = ? AND user_id = ?").run(id, userId);
}

export async function clearPriceChecks(userId: string): Promise<void> {
  await db.prepare("DELETE FROM price_checks WHERE user_id = ?").run(userId);
}

export async function listPriceChecks(userId: string, limit = 100): Promise<PriceCheckEntry[]> {
  const rows = (await db
    .prepare(
      "SELECT * FROM price_checks WHERE user_id = ? ORDER BY checked_at DESC LIMIT ?",
    )
    .all(userId, limit)) as unknown as PriceCheckRow[];
  return rows.map(fromRow);
}
