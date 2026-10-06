/**
 * Build src/data/cardmarket-<game>.json: our card id → Cardmarket idProduct,
 * for cards TCGplayer leaves unpriced (10-05, Chris: "use every resource
 * available to get the cards priced"). Read-only against the database; the
 * daily job (lib/server/tcgPriceRefresh.ts) reads the map and Cardmarket's
 * free price guide, and converts EUR to dollars.
 *
 *   node scripts/build-cardmarket-map.mjs --game yugioh [--prod]
 *
 * Cardmarket's product list carries no set code, number or rarity, only a
 * numeric idExpansion. So: each of our sets is pinned to the expansion that
 * holds the most of the set's card NAMES (all of them, priced or not), and
 * only when it holds at least 60% of them and clearly beats the runner-up
 * (runner-up under 80% of it). Inside it, a card takes a product only when
 * exactly one product carries its name; a name repeated per rarity
 * ("(V.1 - Ultra Rare)") is settled by our rarity, else left out.
 */
import fs from "node:fs";
import { createClient } from "@libsql/client";

const game = process.argv[process.argv.indexOf("--game") + 1];
const CM_GAME = { yugioh: 3, lorcana: 19, onepiece: 18 }[game];
if (!CM_GAME) throw new Error("--game yugioh|lorcana|onepiece");
const UA = { "User-Agent": "CardFlip/1.0 (support@cardflip.io)" };

let c;
if (process.argv.includes("--prod")) {
  const creds = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿|^ï»¿/, ""));
  c = createClient({ url: creds.dbUrl, authToken: creds.dbToken });
} else {
  c = createClient({ url: "file:data/cardflip.db" });
}

const cached = async (url, file) => {
  if (!fs.existsSync(file)) {
    const r = await fetch(url, { headers: UA });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    fs.writeFileSync(file, await r.text());
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
};
const base = "https://downloads.s3.cardmarket.com/productCatalog";
const products = (await cached(`${base}/productList/products_singles_${CM_GAME}.json`, `backups/cm-products-${CM_GAME}.json`)).products;

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const tagOf = (s) => /\(([^)]*)\)\s*$/.exec(s)?.[1] ?? "";
const bare = (s) => s.replace(/\s*\([^)]*\)\s*$/, "");
const byExpansion = new Map();
for (const p of products) {
  const k = `${p.idExpansion}|${norm(bare(p.name))}`;
  byExpansion.set(k, [...(byExpansion.get(k) ?? []), p]);
}
const expansionsOf = new Map();
for (const p of products) {
  const n = norm(bare(p.name));
  if (!expansionsOf.has(n)) expansionsOf.set(n, new Set());
  expansionsOf.get(n).add(p.idExpansion);
}

const nameOf = (r) => (r.subtitle ? `${r.name} - ${r.subtitle}` : r.name);
const rows = (await c.execute({ sql: "SELECT id, name, subtitle, set_code, set_name, rarity, price_usd, price_usd_foil FROM tcg_cards WHERE game = ?", args: [game] })).rows;
const bySet = new Map();
for (const r of rows) bySet.set(`${r.set_code}|${r.set_name}`, [...(bySet.get(`${r.set_code}|${r.set_name}`) ?? []), r]);

const map = {};
const report = { sets: 0, pinned: 0, gaps: 0, mapped: 0, ambiguous: 0, missing: 0, unpinned: [] };
for (const [key, list] of bySet) {
  const gaps = list.filter((r) => r.price_usd == null && r.price_usd_foil == null);
  if (!gaps.length) continue;
  report.sets++;
  report.gaps += gaps.length;
  const names = [...new Set(list.map((r) => norm(nameOf(r))))];
  const count = new Map();
  for (const n of names) for (const e of expansionsOf.get(n) ?? []) count.set(e, (count.get(e) ?? 0) + 1);
  const top = [...count].sort((a, b) => b[1] - a[1]);
  const [best, second] = top;
  if (!best || best[1] < Math.max(2, 0.6 * names.length) || (second && second[1] >= 0.8 * best[1])) {
    report.unpinned.push(`${key} (${gaps.length} gaps; best ${best?.[1] ?? 0}/${names.length}, next ${second?.[1] ?? 0})`);
    continue;
  }
  report.pinned++;
  for (const r of gaps) {
    let cand = byExpansion.get(`${best[0]}|${norm(nameOf(r))}`) ?? [];
    if (cand.length > 1 && r.rarity) cand = cand.filter((p) => norm(tagOf(p.name)).includes(norm(r.rarity)));
    if (cand.length === 1) {
      map[r.id] = cand[0].idProduct;
      report.mapped++;
    } else if (cand.length > 1) report.ambiguous++;
    else report.missing++;
  }
}
fs.mkdirSync("src/data", { recursive: true });
fs.writeFileSync(`src/data/cardmarket-${game}.json`, JSON.stringify(map, null, 0) + "\n");
console.log(JSON.stringify({ ...report, unpinned: report.unpinned.slice(0, 40) }, null, 1));
process.exit(0);
