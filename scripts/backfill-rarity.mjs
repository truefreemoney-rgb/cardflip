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
// Second pass: sets the upstream catalog doesn't carry yet (Black Bolt and
// White Flare on 09-04). TCGplayer's product feed lists Rarity, and the
// row's catalog id maps to a product — one products fetch per group.
const left = await db
  .prepare(
    `SELECT c.id, c.card_name, p.product_id, p.group_id
       FROM cards c JOIN tcgplayer_products p ON p.card_id = c.catalog_card_id
      WHERE c.kind = 'card' AND c.rarity IS NULL AND c.game = 'pokemon'`,
  )
  .all();
const byGroup = new Map();
for (const r of left) {
  if (!byGroup.has(r.group_id)) byGroup.set(r.group_id, []);
  byGroup.get(r.group_id).push(r);
}
let second = 0;
for (const [gid, list] of byGroup) {
  try {
    const res = await fetch(`https://tcgcsv.com/tcgplayer/3/${gid}/products`, {
      headers: { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)" },
    });
    const products = (await res.json()).results ?? [];
    const rarityOf = new Map(
      products.map((p) => [p.productId, (p.extendedData ?? []).find((e) => e.name === "Rarity")?.value ?? null]),
    );
    for (const r of list) {
      const rarity = rarityOf.get(r.product_id);
      if (!rarity) continue;
      await db.prepare("UPDATE cards SET rarity = ? WHERE id = ?").run(rarity, r.id);
      second++;
    }
  } catch (err) {
    console.warn(`tcgcsv group ${gid}: ${err instanceof Error ? err.message : err}`);
  }
}
const stillMissing = await db.prepare("SELECT count(*) AS n FROM cards WHERE kind = 'card' AND rarity IS NULL").get();
console.log(`\nfilled ${filled} from the catalog, ${second} from TCGplayer; ${stillMissing?.n ?? "?"} rows still without a rarity`);
process.exit(0);
