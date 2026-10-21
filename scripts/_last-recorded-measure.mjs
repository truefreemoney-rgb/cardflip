// Read-only (prod SELECTs): card pages with no fresh row that lib/cardPages.ts lastRecordedPrice (10-21) now prices.
// Stored backups (cardtrader / cardmarket-converted) still come first on the page; this lists before them.
// node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_last-recorded-measure.mjs pokemon
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { judgeFull } = await import(at("lib/server/priceTrustSite.ts"));
const { decodePrices, todayUtc, addDays } = await import(at("lib/priceSeries.ts"));
const { lastPriced, REF_ALT_SOURCE, PRICE_TRUST } = await import(at("lib/server/priceTrust.ts"));
const { EBAY_REFEREE } = await import(at("lib/ebayReferee.ts"));
const cp = await import(at("lib/cardPages.ts"));

const game = process.argv[2] ?? "pokemon";
const day = todayUtc();
const q = async (sql, args = []) => (await c.execute({ sql, args })).rows;
const isSealedId = (id) => id.startsWith("sealed-") || id.startsWith("tcgp-sealed-");

const names = new Map();
const meta = new Map();
if (game === "pokemon") for (const r of await q("SELECT id, name, set_name, local_id, set_release_date FROM en_cards")) { meta.set(r.id, { released: r.set_release_date ?? "", eur: null }); names.set(r.id, `${r.name} | ${r.set_name} ${r.local_id}`); }
if (game === "mtg") for (const r of await q("SELECT id, name, set_code, collector_number, set_release_date, price_eur, price_eur_foil FROM mtg_cards WHERE price_usd >= 10 OR price_usd_foil >= 10")) { meta.set(r.id, { released: r.set_release_date ?? "", eur: { nonfoil: r.price_eur ?? null, foil: r.price_eur_foil ?? null } }); names.set(r.id, `${r.name} | ${r.set_code} ${r.collector_number}`); }

const data = new Map();
const get = (id) => {
  let d = data.get(id);
  if (!d) data.set(id, (d = { game, series: [], cmEur: null, cmEurAlt: null, eur: meta.get(id)?.eur ?? null, released: meta.get(id)?.released ?? "" }));
  return d;
};
const cmSince = addDays(day, -PRICE_TRUST.refMaxAgeDays);
for (let off = 0; ; off += 5000) {
  const rs = await q(
    `SELECT card_id, variant, source, start_day, prices FROM price_series WHERE game = ? AND ((source='tcgplayer' AND currency='USD') OR (source IN ('cardmarket', '${REF_ALT_SOURCE}') AND variant='average' AND updated_day >= ?)) ORDER BY card_id, variant, source LIMIT 5000 OFFSET ${off}`,
    [game, cmSince],
  );
  for (const r of rs) {
    if (isSealedId(r.card_id) || (game === "mtg" && !meta.has(r.card_id))) continue;
    const p = decodePrices(r.prices);
    const d = get(r.card_id);
    if (r.source === "cardmarket") d.cmEur = lastPriced(p);
    else if (r.source === REF_ALT_SOURCE) d.cmEurAlt = lastPriced(p);
    else if (p.some((v) => v != null)) d.series.push({ variant: r.variant, startDay: r.start_day, prices: p });
  }
  if (rs.length < 5000) break;
}
for (const l of await q("SELECT card_id, variant, low_usd FROM listing_lows WHERE game = ? AND day >= ?", [game, addDays(day, -3)])) {
  const d = data.get(l.card_id);
  if (d && l.low_usd > 0) d.lows = { ...(d.lows ?? {}), [l.variant]: Number(l.low_usd) };
}
const since = addDays(day, -EBAY_REFEREE.maxAgeDays);
for (const r of await q("SELECT card_id, variant, n, n_nm, median_usd, q75_usd, vintage, day, manual, manual_price FROM ebay_asks WHERE game = ? AND (day >= ? OR manual IS NOT NULL)", [game, since])) {
  const d = data.get(r.card_id);
  if (!d) continue;
  const reading = r.day >= since ? { n: Number(r.n), nNm: Number(r.n_nm), median: r.median_usd == null ? null : Number(r.median_usd), q75: r.q75_usd == null ? null : Number(r.q75_usd), vintage: Number(r.vintage) === 1 } : null;
  d.asks = { ...(d.asks ?? {}), [r.variant]: { reading, manual: r.manual === "hide" || r.manual === "keep" ? r.manual : null, manualPrice: r.manual_price == null ? null : Number(r.manual_price) } };
}

const got = [];
let blank = 0;
for (const [id, d] of data) {
  const judged = d.series.map((s) => ({ ...s, ...judgeFull(d, { variant: s.variant, exact: true, day }) }));
  if (cp.variantPrices(game, judged, day).length > 0) continue;
  blank++;
  const last = cp.lastRecordedPrice(game, judged, day);
  if (last) got.push({ id, name: names.get(id) ?? "", ...last });
}
console.log(`${game}: cards with series but no fresh row: ${blank}; priced by lastRecordedPrice: ${got.length} ($100+: ${got.filter((g) => g.price >= 100).length})`);
for (const g of got.sort((a, b) => b.price - a.price).slice(0, 25)) console.log(`  $${g.price} ${g.variant} as of ${g.day} (${g.stale.days}d, ${g.days} priced days)  ${g.id} ${g.name}`);