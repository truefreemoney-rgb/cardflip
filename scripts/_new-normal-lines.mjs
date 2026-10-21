// READ ONLY (prod): Pokemon cards where TCGplayer started a NEW "normal" line recently next to an older holofoil line
// (ex7-99 Rocket's Mewtwo ex, 10-17: the young normal line is flagged and headlinePrice then blanks the page headline).
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const since = process.argv[2] ?? "2026-10-01";
const rows = (await c.execute({
  sql: `SELECT n.card_id, n.start_day AS n_start, n.prices AS n_prices, h.start_day AS h_start, h.prices AS h_prices
        FROM price_series n JOIN price_series h ON h.card_id = n.card_id AND h.game = n.game AND h.source = 'tcgplayer' AND h.currency = 'USD' AND h.variant = 'holofoil'
        WHERE n.game = 'pokemon' AND n.source = 'tcgplayer' AND n.currency = 'USD' AND n.variant = 'normal' AND n.start_day >= ? AND h.start_day < ?`,
  args: [since, since],
})).rows;
const last = (s) => { const a = JSON.parse(String(s)).filter((v) => v != null); return a.length ? a[a.length - 1] : null; };
const out = rows.map((r) => ({ id: r.card_id, nStart: r.n_start, n: last(r.n_prices), h: last(r.h_prices) })).sort((a, b) => (b.h ?? 0) - (a.h ?? 0));
console.log(`${out.length} Pokemon cards got a new normal line on/after ${since} next to an older holofoil line`);
console.log(`holofoil >= $100: ${out.filter((x) => (x.h ?? 0) >= 100).length}`);
for (const x of out.slice(0, 15)) console.log(`${x.id} normal from ${x.nStart} $${x.n} | holofoil $${x.h}`);
