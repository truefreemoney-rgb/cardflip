// Disney Lorcana mirror from Lorcast (https://api.lorcast.com/v0, free, no
// key): every set, every card, USD + foil prices, images (AVIF — the panel
// and the tiebreak convert to JPEG with sharp before Claude sees them).
// Writes tcg_cards rows with game = 'lorcana' (docs/NEW-GAMES.md).
//
//   npm run sync:lorcana
//
// Same shape as sync-mtg.mjs: creates the table if the app never ran here,
// upserts by id, prints counts. Prod gets the rows through
// scripts/push-catalog.mjs (tcg_cards is in CATALOG_TABLES).
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const API = "https://api.lorcast.com/v0";
const HEADERS = { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)", Accept: "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = new DatabaseSync(process.env.CARDFLIP_DB_PATH ?? path.join(process.cwd(), "data", "cardflip.db"));
db.exec(`CREATE TABLE IF NOT EXISTS tcg_cards (
  id TEXT PRIMARY KEY, game TEXT NOT NULL, name TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '',
  set_code TEXT NOT NULL, set_name TEXT NOT NULL, collector_number TEXT NOT NULL, set_total INTEGER,
  set_release_date TEXT NOT NULL DEFAULT '', rarity TEXT NOT NULL DEFAULT '', variant TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '', price_usd REAL, price_usd_foil REAL, art_hash TEXT NOT NULL DEFAULT '',
  synced_at INTEGER NOT NULL)`);

async function getJson(url, attempt = 1) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 6) throw new Error(`${url} → ${res.status} after ${attempt} tries`);
    await sleep(2000 * attempt);
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

const upsert = db.prepare(`INSERT INTO tcg_cards (id, game, name, subtitle, set_code, set_name, collector_number, set_total, set_release_date, rarity, variant, image_url, price_usd, price_usd_foil, synced_at)
  VALUES (?, 'lorcana', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, subtitle = excluded.subtitle, set_code = excluded.set_code, set_name = excluded.set_name,
    collector_number = excluded.collector_number, set_total = excluded.set_total, set_release_date = excluded.set_release_date, rarity = excluded.rarity,
    variant = excluded.variant, image_url = excluded.image_url, price_usd = excluded.price_usd, price_usd_foil = excluded.price_usd_foil, synced_at = excluded.synced_at`);

const now = Date.now();
const sets = await getJson(`${API}/sets`);
const list = Array.isArray(sets) ? sets : sets.results ?? sets.data ?? [];
console.log(`${list.length} Lorcana sets`);
let total = 0;
for (const set of list) {
  let cards;
  try {
    cards = await getJson(`${API}/sets/${encodeURIComponent(set.code)}/cards`);
  } catch (err) {
    console.log(`  !! ${set.code} ${set.name}: ${err.message}`);
    continue;
  }
  const rows = Array.isArray(cards) ? cards : cards.results ?? cards.data ?? [];
  // The printed denominator is the count of regular-numbered cards; the
  // enchanted / special printings number past it (205+ in a /204 set).
  const numeric = rows.map((c) => Number(c.collector_number)).filter((n) => Number.isFinite(n));
  const rarities = new Set(rows.map((c) => c.rarity));
  const regular = numeric.filter((n, i) => !/enchanted|special/i.test(rows[i]?.rarity ?? ""));
  const setTotal = regular.length ? Math.max(...regular) : numeric.length ? Math.max(...numeric) : null;
  db.exec("BEGIN");
  for (const c of rows) {
    if (c.lang && c.lang !== "en") continue;
    const rarity = String(c.rarity ?? "");
    const num = Number(c.collector_number);
    const variant = /enchanted/i.test(rarity) ? "enchanted" : /special/i.test(rarity) ? "special" : setTotal && Number.isFinite(num) && num > setTotal ? "special" : "";
    upsert.run(
      c.id,
      c.name ?? "",
      c.version ?? "",
      String(set.code),
      set.name ?? "",
      String(c.collector_number ?? ""),
      setTotal,
      c.released_at ?? set.released_at ?? "",
      rarity,
      variant,
      c.image_uris?.digital?.large ?? c.image_uris?.digital?.normal ?? "",
      c.prices?.usd != null ? Number(c.prices.usd) : null,
      c.prices?.usd_foil != null ? Number(c.prices.usd_foil) : null,
      now,
    );
    total++;
  }
  db.exec("COMMIT");
  console.log(`  ${set.code.padEnd(6)} ${set.name.padEnd(34)} ${rows.length} cards, /${setTotal ?? "?"} (${[...rarities].join(", ")})`);
  await sleep(150);
}
const n = db.prepare("SELECT COUNT(*) AS n FROM tcg_cards WHERE game = 'lorcana'").get().n;
console.log(`lorcana: ${total} cards written, ${n} rows in the mirror`);
