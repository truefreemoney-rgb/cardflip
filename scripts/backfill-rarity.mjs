// Fill cards.rarity for ledger rows scanned before rarity was stored (09-04).
//
//   npm run backfill:rarity            # local data/cardflip.db
//   TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… npm run backfill:rarity   # prod
//
// Magic rows read the mirror directly (mtg_cards.rarity). Pokémon rows go
// through the same catalog lookup the editor uses (mirror row, then the
// upstream price/rarity join in enrichWithPricing), one lookup per distinct
// catalog card. Rows that can't be resolved are left null and reported.
const { db } = await import("../src/lib/db.ts");
const { englishCardById, searchEnglishCardsLocal, enrichWithPricing } = await import("../src/lib/server/enCards.ts");
const { normalizeNumber } = await import("../src/lib/cardNumber.ts");

const rows = await db
  .prepare(
    `SELECT id, game, card_name, card_number, set_name, catalog_card_id
       FROM cards WHERE kind = 'card' AND rarity IS NULL`,
  )
  .all();
console.log(`${rows.length} rows without rarity`);

const cache = new Map();
let filled = 0;
const missed = [];

async function pokemonRarity(row) {
  const key = row.catalog_card_id || `${row.card_name}|${row.card_number}|${row.set_name}`;
  if (cache.has(key)) return cache.get(key);
  let rarity = null;
  try {
    let local = row.catalog_card_id ? await englishCardById(row.catalog_card_id) : { cards: [], releaseDates: new Map() };
    if (local.cards.length === 0) {
      local = await searchEnglishCardsLocal(row.card_name, row.card_number ? { number: row.card_number, setTotal: null, setCode: null, isSecretRare: false } : null, 24);
      const pick =
        local.cards.find((c) => c.setName === row.set_name && normalizeNumber(c.number) === normalizeNumber(row.card_number)) ??
        local.cards.find((c) => normalizeNumber(c.number) === normalizeNumber(row.card_number)) ??
        null;
      local = pick ? { cards: [pick], releaseDates: new Map([[pick.id, local.releaseDates.get(pick.id) ?? ""]]) } : { cards: [], releaseDates: new Map() };
    }
    if (local.cards.length) {
      const [priced] = await enrichWithPricing(local.cards, local.releaseDates);
      rarity = priced?.rarity ?? null;
    }
  } catch (err) {
    console.warn(`  ${row.card_name}: ${err instanceof Error ? err.message : err}`);
  }
  cache.set(key, rarity);
  return rarity;
}

async function mtgRarity(row) {
  const byId = row.catalog_card_id
    ? await db.prepare("SELECT rarity FROM mtg_cards WHERE id = ?").get(row.catalog_card_id)
    : null;
  if (byId?.rarity) return byId.rarity;
  const byName = await db
    .prepare("SELECT rarity FROM mtg_cards WHERE name = ? AND collector_number = ? AND set_name = ? LIMIT 1")
    .get(row.card_name, row.card_number, row.set_name);
  return byName?.rarity ?? null;
}

for (const row of rows) {
  const rarity = row.game === "mtg" ? await mtgRarity(row) : await pokemonRarity(row);
  if (!rarity) {
    missed.push(`${row.card_name} ${row.card_number} (${row.set_name})`);
    continue;
  }
  await db.prepare("UPDATE cards SET rarity = ? WHERE id = ?").run(rarity, row.id);
  filled++;
  process.stdout.write(`\r${filled}/${rows.length} filled`);
}
console.log(`\nfilled ${filled}, unresolved ${missed.length}`);
if (missed.length) console.log(missed.slice(0, 20).join("\n"));
process.exit(0);
