// Read-only: sizing + naming facts for the nightly eBay referee (live Turso). 10-13.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const q = async (sql) => (await c.execute(sql)).rows;
console.log(await q("SELECT game, variant, COUNT(*) n FROM price_series WHERE source='tcgplayer' GROUP BY game, variant HAVING n > 50 ORDER BY game, n DESC"));
console.log(await q("SELECT game, variant, COUNT(*) n FROM listing_lows GROUP BY game, variant ORDER BY game, n DESC"));
console.log(await q("SELECT game, variant, COUNT(*) n FROM tcg_cards GROUP BY game, variant HAVING n > 20 ORDER BY game, n DESC LIMIT 30"));
