import { db } from "@/lib/db";
import handMap from "@/data/pokemon-tcgplayer-hand-map.json" with { type: "json" };

/**
 * Hand-picked card → TCGplayer product rows for catalog cards the automatic
 * matcher (mapNewPokemonGroups) cannot reach: gold stars, ex promos, the
 * Skyridge H cards, Worlds prize cards. Data: src/data/pokemon-tcgplayer-hand-map.json,
 * each entry checked by hand against tcgcsv's product name and Number.
 * Idempotent and best-effort: a row is only added when neither the card nor
 * the product already has a mapping, so nothing is ever overwritten.
 */
export interface HandMapEntry {
  cardId: string;
  productId: number;
  groupId: number;
  productName: string;
  note: string;
}

export async function loadPokemonHandMap(entries: HandMapEntry[] = handMap as HandMapEntry[]): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  try {
    for (const e of entries) {
      const taken = await db
        .prepare("SELECT 1 AS ok FROM tcgplayer_products WHERE game = 'pokemon' AND (card_id = ? OR product_id = ?) LIMIT 1")
        .get(e.cardId, e.productId);
      if (taken) {
        skipped++;
        continue;
      }
      await db
        .prepare("INSERT OR IGNORE INTO tcgplayer_products (product_id, group_id, card_id, game) VALUES (?, ?, ?, 'pokemon')")
        .run(e.productId, e.groupId, e.cardId);
      added++;
    }
  } catch (err) {
    console.warn("pokemon hand map:", err instanceof Error ? err.message : err);
  }
  return { added, skipped };
}
