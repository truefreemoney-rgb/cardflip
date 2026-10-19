// Read-only measure (10-19): what a Pokémon-style listing cap would do to Yu-Gi-Oh! prices.
// One slow pass over tcgcsv.com (TCGplayer's daily prices, category 2), 1 request at a time, 300 ms apart.
// Writes data/ygo-cap-measure.json; names come from the LOCAL mirror (data/cardflip.db, never written).
//   node scripts/_ygo-cap-measure.mjs
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
const API = "https://tcgcsv.com/tcgplayer/2";
const UA = { "user-agent": "CardFlip price check (https://cardflip.io)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pos = (v) => (typeof v === "number" && v > 0 ? v : null);
async function getJson(url) {
  for (let a = 1; a <= 3; a++) {
    const res = await fetch(url, { headers: UA });
    if (res.ok) return res.json();
    if (a === 3) throw new Error(`${res.status} ${url}`);
    await sleep(2000 * a);
  }
}
const groups = (await getJson(`${API}/groups`)).results ?? [];
console.log(groups.length, "groups");
const rows = [];
let n = 0;
for (const g of groups) {
  try {
    for (const p of (await getJson(`${API}/${g.groupId}/prices`)).results ?? []) {
      const market = pos(p.marketPrice), low = pos(p.lowPrice);
      if (market == null) continue;
      const sub = p.subTypeName ?? "";
      const id = `ygo-${p.productId}${sub === "1st Edition" ? "-1st" : ""}`;
      rows.push({ id, sub, market, low, mid: pos(p.midPrice) });
    }
  } catch (err) {
    console.warn("group", g.groupId, err.message);
  }
  if (++n % 50 === 0) console.log(n, "groups read,", rows.length, "prices");
  await sleep(300);
}
const local = new DatabaseSync("data/cardflip.db", { readOnly: true });
const nameOf = local.prepare("SELECT name, set_name, collector_number, rarity FROM tcg_cards WHERE id = ?");
for (const r of rows) {
  const c = nameOf.get(r.id);
  if (c) Object.assign(r, { name: c.name, set: c.set_name, num: c.collector_number, rarity: c.rarity });
}
fs.writeFileSync("data/ygo-cap-measure.json", JSON.stringify(rows));
const cap = (m, l) => (m >= 20 && l != null && m >= 1.45 * l ? Math.round(l * 1.45 * 100) / 100 : m);
const big = rows.filter((r) => r.market >= 20 && r.name);
const capped = big.filter((r) => cap(r.market, r.low) < r.market);
console.log(`\n$20+ priced printings in our catalog: ${big.length}; the 1.45x cap would lower ${capped.length} (${((capped.length / big.length) * 100).toFixed(1)}%)`);
const bands = [[1.45, 2], [2, 3], [3, 5], [5, 1e9]];
for (const [a, b] of bands) console.log(`  market ${a}x-${b === 1e9 ? "+" : b + "x"} the cheapest listing: ${capped.filter((r) => r.market / r.low >= a && r.market / r.low < b).length}`);
console.log("\nPot of Greed DB1:", JSON.stringify(rows.find((r) => r.id === "ygo-23670")));
console.log("\nbiggest $ cuts:");
for (const r of capped.sort((x, y) => (y.market - cap(y.market, y.low)) - (x.market - cap(x.market, x.low))).slice(0, 25))
  console.log(`  ${r.id} ${r.name} | ${r.set} ${r.num} ${r.rarity} ${r.sub}: $${r.market} -> $${cap(r.market, r.low)} (low $${r.low})`);
