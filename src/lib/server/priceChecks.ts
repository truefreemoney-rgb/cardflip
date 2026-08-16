import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { pickPrice } from "@/lib/listing";
import type { PokemonCard, ScanLanguage } from "@/lib/types";

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
  };
}

export function logPriceCheck(
  userId: string,
  card: PokemonCard,
  language: ScanLanguage,
): PriceCheckEntry {
  const id = randomUUID();
  const checkedAt = Date.now();
  const representativePrice = pickPrice(card)?.market ?? null;

  db.prepare(
    `INSERT INTO price_checks
       (id, user_id, card_name, set_name, card_number, language, representative_price, prices_json, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  };
}

export function listPriceChecks(userId: string, limit = 100): PriceCheckEntry[] {
  const rows = db
    .prepare(
      "SELECT * FROM price_checks WHERE user_id = ? ORDER BY checked_at DESC LIMIT ?",
    )
    .all(userId, limit) as unknown as PriceCheckRow[];
  return rows.map(fromRow);
}
