// READ ONLY (prod read + public tcgcsv), 10-21: why Magic printings with no price of any kind stay blank after the
// nightly TCGplayer fill. Per set: matched group, products, rows matched, and for misses the nearest product by name.
// node --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_mtg-gap-why.mjs [setCode ...]
import fs from "node:fs";
import { createClient } from "@libsql/client";
import { groupProducts, matchGroup, matchMtgProducts } from "@/lib/server/mtgTcgplayerFill";
import { tcgcsvFetch, TCGCSV_HEADERS } from "@/lib/server/tcgcsv";

const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const q = async (sql, args = []) => (await c.execute({ sql, args })).rows;
const want = process.argv.slice(2).map((s) => s.toLowerCase());
const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
const fresh = new Set((await q("SELECT DISTINCT card_id FROM price_series WHERE game = 'mtg' AND updated_day >= ?", [since])).map((r) => String(r.card_id)));
const rows = (await q(`SELECT id, oracle_id, name, set_code, set_name, collector_number, finishes, set_release_date FROM mtg_cards
  WHERE price_usd IS NULL AND price_usd_foil IS NULL AND price_usd_etched IS NULL AND price_eur IS NULL AND price_eur_foil IS NULL`))
  .filter((r) => !fresh.has(String(r.id)) && (!want.length || want.includes(String(r.set_code).toLowerCase())))
  .map((r) => ({ id: r.id, name: r.name, setCode: r.set_code, setName: r.set_name, number: r.collector_number, finishes: r.finishes ?? "", oracleId: r.oracle_id, released: r.set_release_date ?? "" }));
const groups = ((await (await tcgcsvFetch("https://tcgcsv.com/tcgplayer/1/groups", { headers: TCGCSV_HEADERS })).json()).results ?? []);
const bySet = new Map();
for (const r of rows) bySet.set(r.setCode, [...(bySet.get(r.setCode) ?? []), r]);
const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
for (const [code, list] of [...bySet].sort((a, b) => b[1].length - a[1].length).slice(0, 12)) {
  const g = matchGroup(code, list[0].setName, groups);
  if (!g) { console.log(`${code} "${list[0].setName}" (${list.length}): NO GROUP`); continue; }
  const products = await groupProducts(g.groupId);
  const fills = matchMtgProducts(list, products);
  console.log(`${code} "${list[0].setName}" (${list.length}) -> group ${g.groupId} "${g.name}" [${g.abbreviation}]: ${products.length} priced products, ${fills.length} rows match`);
  const hit = new Set(fills.map((f) => f.id));
  for (const r of list.filter((x) => !hit.has(x.id)).slice(0, 4)) {
    const same = products.filter((p) => fold(p.name).startsWith(fold(r.name)));
    console.log(`   miss ${r.name} #${r.number} [${r.finishes}] released ${r.released}; products named so: ${same.length ? same.slice(0, 3).map((p) => `"${p.name}" #${p.number} ${JSON.stringify(p.prices)}`).join(" | ") : "none"}`);
  }
  await new Promise((res) => setTimeout(res, 300));
}
