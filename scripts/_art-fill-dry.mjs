// DRY RUN vs prod (read-only): which unpriced English Art Series rows the TCGplayer matcher fills.
import fs from "node:fs";
import { createClient } from "@libsql/client";
import { tcgplayerFills } from "@/lib/server/mtgTcgplayerFill";
const creds = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const c = createClient({ url: creds.dbUrl, authToken: creds.dbToken });
const rows = (await c.execute(`SELECT id, oracle_id, name, set_code, set_name, collector_number, finishes FROM mtg_cards WHERE lang='en' AND set_name LIKE '%Art Series' AND price_usd IS NULL AND price_usd_foil IS NULL AND price_usd_etched IS NULL`)).rows
  .map((r) => ({ id: r.id, name: r.name, setCode: r.set_code, setName: r.set_name, number: r.collector_number, finishes: r.finishes ?? "", oracleId: r.oracle_id }));
const { fills, dropped } = await tcgplayerFills(rows);
const got = new Map(fills.map((f) => [f.id, f]));
console.log(`gaps ${rows.length}, filled ${fills.length}, dropped by guard ${dropped}`);
for (const r of rows) { const f = got.get(r.id); console.log(`${f ? "FILL" : "    "} ${r.setCode} ${r.number} ${r.name}${f ? ` $${f.usd ?? ""}/${f.foil ?? ""}` : ""}`); }
