// #3 (10-30): Yu-Gi-Oh! cards whose TCGplayer printing has only asking prices (no sales) = blank on the site.
// Queue for hand eBay sold checks, highest asking first, minus cards that already have a price_checked row.
// Prod SELECT only. Run: node scripts/_ygo-nosale-queue.mjs -> data/ygo-nosale-queue-2026-10-30.json
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;

const old = JSON.parse(fs.readFileSync("data/ygo-stale-2026-10-23.json", "utf8")).filter((o) => /asking only/.test(o.kind));
const ids = old.map((o) => o.id);
const ph = ids.map(() => "?").join(",");
const series = new Map((await q(`SELECT card_id, variant, updated_day, prices FROM price_series WHERE game='yugioh' AND source='tcgplayer' AND card_id IN (${ph})`, ids)).map((r) => [r.card_id, r]));
const checked = new Set((await q(`SELECT card_id FROM price_checked WHERE game='yugioh' AND card_id IN (${ph})`, ids)).map((r) => r.card_id));
const rarity = new Map((await q(`SELECT id, rarity FROM tcg_cards WHERE id IN (${ph})`, ids)).map((r) => [r.id, r.rarity]));
const out = [];
for (const o of old) {
  const m = o.id.endsWith("-1st") ? o.subs["1st Edition"] : o.subs["Unlimited"] ?? o.subs["Limited"];
  const s = series.get(o.id);
  out.push({ id: o.id, name: o.name, set: o.set, num: o.num, rarity: rarity.get(o.id) ?? null, first: o.id.endsWith("-1st"), mid: m?.mid ?? null, low: m?.low ?? null,
    variant: s?.variant ?? null, updated: s?.updated_day ?? null, checked: checked.has(o.id) });
}
out.sort((a, b) => (b.mid ?? 0) - (a.mid ?? 0));
const todo = out.filter((o) => !o.checked);
console.log(`asking-only ${out.length}, already checked ${out.length - todo.length}, still updated since 10-25: ${todo.filter((o) => o.updated >= "2026-10-25").length}`);
console.log("variants:", [...new Set(out.map((o) => o.variant))]);
for (const o of todo.slice(0, 40)) console.log([o.id, o.name, o.num, o.rarity, o.mid, o.low, o.updated].join(" | "));
fs.writeFileSync("data/ygo-nosale-queue-2026-10-30.json", JSON.stringify(todo, null, 1));
db.close();
