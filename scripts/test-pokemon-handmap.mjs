/**
 * Pokémon TCGplayer hand map (src/data/pokemon-tcgplayer-hand-map.json).
 * Run: npm run test:pokemonhandmap
 * Pins: file shape, no duplicate cards or products, the loader fills an empty
 * table, a second run changes nothing, and an existing different mapping
 * (by card or by product) is left alone. Local throwaway DB only.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const mapFile = path.resolve("src/data/pokemon-tcgplayer-hand-map.json");
const work = mkdtempSync(path.join(tmpdir(), "cardflip-handmap-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const { loadPokemonHandMap } = await import("../src/lib/server/pokemonHandMap.ts");
const { db } = await import("../src/lib/db.ts");

let passed = 0;
const ok = (label, cond) => { assert.ok(cond, label); passed++; console.log(`  PASS  ${label}`); };
const eq = (label, a, b) => { assert.deepEqual(a, b, label); passed++; console.log(`  PASS  ${label}`); };

const entries = JSON.parse(readFileSync(mapFile, "utf8"));
ok("file is a non-empty array", Array.isArray(entries) && entries.length > 0);
for (const e of entries) {
  ok(`${e.cardId} has every field`,
    typeof e.cardId === "string" && e.cardId && Number.isInteger(e.productId) && Number.isInteger(e.groupId) &&
    typeof e.productName === "string" && e.productName && typeof e.note === "string");
}
ok("no duplicate cardIds", new Set(entries.map((e) => e.cardId)).size === entries.length);
ok("no duplicate productIds", new Set(entries.map((e) => e.productId)).size === entries.length);

const rows = async () => (await db.prepare("SELECT product_id, group_id, card_id, game FROM tcgplayer_products ORDER BY product_id").all());
eq("table starts empty", (await rows()).length, 0);
const first = await loadPokemonHandMap();
eq("first run adds every entry", first, { added: entries.length, skipped: 0 });
const after1 = await rows();
eq("rows landed with game pokemon", after1.length, entries.length);
ok("all rows are pokemon", after1.every((r) => r.game === "pokemon"));
const second = await loadPokemonHandMap();
eq("second run adds nothing", second, { added: 0, skipped: entries.length });
eq("second run changes no rows", await rows(), after1);

// An existing different mapping stays: the card is mapped elsewhere, and a product is held by another card.
await db.prepare("DELETE FROM tcgplayer_products").run();
const [a, b] = entries;
await db.prepare("INSERT INTO tcgplayer_products (product_id, group_id, card_id, game) VALUES (?, ?, ?, 'pokemon')").run(999001, 1, a.cardId);
await db.prepare("INSERT INTO tcgplayer_products (product_id, group_id, card_id, game) VALUES (?, ?, ?, 'pokemon')").run(b.productId, 2, "someone-else");
const third = await loadPokemonHandMap();
eq("conflicting entries skipped", third, { added: entries.length - 2, skipped: 2 });
const all = await rows();
eq("card already mapped keeps its product", all.filter((r) => r.card_id === a.cardId).map((r) => r.product_id), [999001]);
eq("product held by another card is untouched", all.filter((r) => r.product_id === b.productId).map((r) => r.card_id), ["someone-else"]);
ok("the skipped card did not gain a row", !all.some((r) => r.card_id === b.cardId));

// Never throws into the refresh.
await db.prepare("DROP TABLE tcgplayer_products").run();
const broken = await loadPokemonHandMap();
eq("missing table is swallowed", broken.added, 0);

console.log(`\n${passed} checks passed`);
process.exit(0);
