// Read-only: the hand-labelled Magic moves of 11-07/11-08 with their daily series, listing low and check row.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const L = [
  ["F", "Veteran Bodyguard", "2ed"], ["F", "Lifeforce", "leb"], ["F", "Vesuvan Doppelganger", "2ed"], ["F", "Zodiac Horse", "ptk"], ["F", "Blue Ward", "lea"], ["F", "Gisela, the Broken Blade", "inr", "24"],
  ["F", "Twinning Staff", "ncc", "383"], ["F", "Platinum Emperion", "som"], ["F", "Sword of Light and Shadow", "trc", "502"], ["F", "Overgrown Tomb", "trk", "399"], ["F", "Avatar of Growth", "plst"], ["F", "Emrakul", "", ""],
  ["R", "Seluma", "mb2"], ["R", "Thassa", "plst"], ["R", "Watery Grave", "rav"], ["R", "Ulamog", "plst"], ["R", "Howling Mine", "2ed"],
];
const cols = (await db.execute("PRAGMA table_info(mtg_cards)")).rows.map((r) => r.name);
console.log(cols.join(","));
const out = [];
for (const [lab, name, set, num] of L) {
  const rows = (await db.execute({ sql: `SELECT id, name, set_code, set_name, collector_number, price_usd, price_eur FROM mtg_cards WHERE name LIKE ? ${set ? "AND set_code = ?" : ""} ${num ? "AND collector_number = ?" : ""} LIMIT 8`, args: [`${name}%`, ...(set ? [set] : []), ...(num ? [num] : [])] }).catch((e) => ({ rows: [], e }))).rows;
  if (!rows.length) { console.log(lab, name, set, "NOT FOUND"); continue; }
  for (const c of rows) {
    const s = (await db.execute({ sql: "SELECT start_day, prices, updated_day FROM price_series WHERE card_id = ? AND game='mtg' AND source='tcgplayer' AND currency='USD' AND variant='nonfoil'", args: [c.id] })).rows[0];
    const low = (await db.execute({ sql: "SELECT low_usd, day FROM listing_lows WHERE card_id = ? AND variant = 'nonfoil'", args: [c.id] })).rows[0];
    const chk = (await db.execute({ sql: "SELECT usd, n, day, substr(note,1,70) note FROM price_checked WHERE card_id = ? AND game='mtg'", args: [c.id] })).rows;
    console.log(`\n${lab} ${c.name} | ${c.set_code} ${c.collector_number} | ${c.id} | usd ${c.price_usd} eur ${c.price_eur} | low ${low ? low.low_usd + " @" + low.day : "-"} | checks ${chk.map((k) => `${k.usd}@${k.day}`).join(",") || "-"}`);
    if (!s) { console.log("  no series"); continue; }
    const p = JSON.parse(s.prices);
    const base = Date.parse(s.start_day + "T00:00:00Z");
    const tail = p.map((v, i) => [new Date(base + i * 864e5).toISOString().slice(5, 10), v]).slice(-34);
    console.log("  upd", s.updated_day, tail.map(([d, v]) => `${d}:${v ?? "."}`).join(" "));
  }
}
process.exit(0);
