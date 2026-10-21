// READ ONLY (prod): per game, catalog cards with NO price line of any source updated in the last 7 days (the cards a
// page or a scan could show without a number). Sealed products left out. node scripts/_unpriced-prod.mjs [game]
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const q = async (sql, args = []) => (await c.execute({ sql, args })).rows;
const only = process.argv[2];
const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
const catalogs = {
  pokemon: "SELECT id, name || ' | ' || set_name || ' ' || local_id AS label, set_release_date AS rel FROM en_cards",
  mtg: "SELECT id, name || ' | ' || set_code || ' ' || collector_number AS label, set_release_date AS rel, (price_usd IS NOT NULL OR price_usd_foil IS NOT NULL OR price_eur IS NOT NULL OR price_eur_foil IS NOT NULL) AS scry FROM mtg_cards",
  onepiece: "SELECT id, name || ' | ' || set_name || ' ' || collector_number AS label, '' AS rel FROM tcg_cards WHERE game = 'onepiece'",
  lorcana: "SELECT id, name || ' | ' || set_name || ' ' || collector_number AS label, '' AS rel FROM tcg_cards WHERE game = 'lorcana'",
  yugioh: "SELECT id, name || ' | ' || set_name || ' ' || collector_number AS label, '' AS rel FROM tcg_cards WHERE game = 'yugioh'",
};
for (const [game, sql] of Object.entries(catalogs)) {
  if (only && only !== game) continue;
  const cards = (await q(sql)).filter((r) => !String(r.id).startsWith("sealed-") && !String(r.id).startsWith("tcgp-sealed-"));
  const priced = new Set((await q("SELECT DISTINCT card_id FROM price_series WHERE game = ? AND updated_day >= ?", [game, since])).map((r) => String(r.card_id)));
  const none = cards.filter((r) => !priced.has(String(r.id)) && !(game === "mtg" && Number(r.scry) === 1));
  const bySet = {};
  for (const r of none) { const set = String(r.label).split(" | ")[1]?.replace(/\s\S+$/, "") ?? "?"; bySet[set] = (bySet[set] ?? 0) + 1; }
  console.log(`${game}: ${cards.length} cards, no fresh price line${game === "mtg" ? " and no Scryfall price" : ""}: ${none.length}`);
  console.log("  top sets:", Object.entries(bySet).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, n]) => `${s} ${n}`).join("; "));
  console.log("  e.g.:", none.slice(0, 5).map((r) => r.label).join(" ; "));
}
