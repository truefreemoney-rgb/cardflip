import "server-only";
import { db } from "@/lib/db";
import { createCard, updateCard } from "@/lib/server/cards";
import type { GameId } from "@/lib/types";

/**
 * The "Try it now" demo used to reset to a completely empty account, so a
 * visitor with no card in hand saw nothing but blank states. After each wipe
 * we now seed a small ledger that shows the whole pipeline — drafts, live
 * listings and solds — built from real catalog rows so images and names are
 * genuine. Entries whose catalog row is missing (fresh dev DB before a sync)
 * are simply skipped.
 */

interface Seed {
  game: GameId;
  name: string;
  number: string; // en_cards.local_id / mtg_cards.collector_number
  pick: "earliest" | "latest";
  condition: string;
  status: "ready" | "listed" | "sold";
  price: number; // asking price; for sold rows the sale closed a little under
}

const SEEDS: Seed[] = [
  { game: "pokemon", name: "Charizard", number: "4", pick: "earliest", condition: "Lightly Played", status: "sold", price: 812 },
  { game: "pokemon", name: "Umbreon ex", number: "161", pick: "latest", condition: "Near Mint", status: "listed", price: 1450 },
  { game: "pokemon", name: "Pikachu", number: "25", pick: "latest", condition: "Near Mint", status: "ready", price: 14.5 },
  { game: "mtg", name: "Ragavan, Nimble Pilferer", number: "138", pick: "earliest", condition: "Near Mint", status: "listed", price: 74 },
  { game: "mtg", name: "Sheoldred, the Apocalypse", number: "107", pick: "earliest", condition: "Near Mint", status: "ready", price: 68 },
  { game: "mtg", name: "Lightning Bolt", number: "", pick: "earliest", condition: "Moderately Played", status: "sold", price: 2.5 },
];

interface CatalogHit {
  set_name: string;
  local_id: string;
  image_url: string;
}

async function findCatalog(seed: Seed): Promise<CatalogHit | null> {
  const order = seed.pick === "earliest" ? "ASC" : "DESC";
  if (seed.game === "mtg") {
    const row = (await db
      .prepare(
        `SELECT set_name, collector_number AS local_id, image_url FROM mtg_cards
         WHERE name = ? AND (? = '' OR collector_number = ?) AND image_url != '' AND price_usd IS NOT NULL
         ORDER BY set_release_date ${order} LIMIT 1`,
      )
      .get(seed.name, seed.number, seed.number)) as CatalogHit | undefined;
    return row ?? null;
  }
  const row = (await db
    .prepare(
      `SELECT set_name, local_id, image_url FROM en_cards
       WHERE name = ? AND local_id = ? AND image_url != ''
       ORDER BY set_release_date ${order} LIMIT 1`,
    )
    .get(seed.name, seed.number)) as CatalogHit | undefined;
  return row ?? null;
}

const DAY = 24 * 60 * 60 * 1000;

export async function seedDemoCards(userId: string): Promise<void> {
  const now = Date.now();
  for (const [i, seed] of SEEDS.entries()) {
    const hit = await findCatalog(seed);
    if (!hit) continue;
    const record = await createCard(userId, {
      game: seed.game,
      cardName: seed.name,
      setName: hit.set_name,
      cardNumber: hit.local_id,
      imageUrl: hit.image_url,
      condition: seed.condition,
      price: seed.price,
    });
    // Stagger created_at so the ledger doesn't read as one instant burst.
    await db.prepare("UPDATE cards SET created_at = ? WHERE id = ?").run(now - (SEEDS.length - i) * DAY, record.id);
    if (seed.status === "listed") {
      await updateCard(record.id, userId, { status: "listed", listedAt: now - (SEEDS.length - i) * DAY + DAY / 2 });
    } else if (seed.status === "sold") {
      const createdAt = now - (SEEDS.length - i) * DAY;
      await updateCard(record.id, userId, {
        status: "sold",
        listedAt: createdAt + DAY / 2,
        soldPrice: Math.round(seed.price * 0.94 * 100) / 100,
        soldAt: createdAt + DAY,
      });
    }
  }
}
