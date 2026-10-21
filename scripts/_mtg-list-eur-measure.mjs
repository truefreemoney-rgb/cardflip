// Read-only (prod SELECTs), 10-21: Magic set-list tiles that say "This price looks off" while the card's own page prints
// Cardmarket's euro figure in dollars (Will-o'-the-Wisp 2ED 136: list "looks off", page $66.41). = every TCGplayer line
// flagged, no fresh stored backup row (lib/priceChain.ts BACKUP_ORDER), price_eur or price_eur_foil on mtg_cards.
// node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_mtg-list-eur-measure.mjs
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { judgeFull } = await import(at("lib/server/priceTrustSite.ts"));
const { decodePrices, todayUtc, addDays } = await import(at("lib/priceSeries.ts"));
const { lastPriced, REF_ALT_SOURCE, PRICE_TRUST } = await import(at("lib/server/priceTrust.ts"));
const { BACKUP_ORDER } = await import(at("lib/priceChain.ts"));
const { EBAY_REFEREE } = await import(at("lib/ebayReferee.ts"));
const cp = await import(at("lib/cardPages.ts"));

const day = todayUtc();
const q = async (sql, args = []) => (await c.execute({ sql, args })).rows;
const backups = new Set(BACKUP_ORDER.mtg);
const meta = new Map();
for (const r of await q("SELECT id, name, set_code, collector_number, set_release_date, price_eur, price_eur_foil FROM mtg_cards WHERE lang = 'en' AND image_url <> ''"))
  meta.set(r.id, { released: r.set_release_date ?? "", eur: { nonfoil: r.price_eur ?? null, foil: r.price_eur_foil ?? null }, name: `${r.name} | ${r.set_code} ${r.collector_number}` });

const data = new Map();
const hasBackup = new Set();
const get = (id) => {
  let d = data.get(id);
  if (!d) data.set(id, (d = { game: "mtg", series: [], cmEur: null, cmEurAlt: null, eur: meta.get(id).eur, released: meta.get(id).released }));
  return d;
};
const cmSince = addDays(day, -PRICE_TRUST.refMaxAgeDays);
for (let off = 0; ; off += 5000) {
  const rs = await q(
    `SELECT card_id, variant, source, currency, start_day, updated_day, prices FROM price_series WHERE game = 'mtg' ORDER BY card_id, variant, source LIMIT 5000 OFFSET ${off}`,
  );
  for (const r of rs) {
    if (!meta.has(r.card_id)) continue;
    const p = decodePrices(r.prices);
    if (backups.has(r.source) && r.currency === "USD") { if (r.updated_day >= cmSince && (lastPriced(p) ?? 0) > 0) hasBackup.add(r.card_id); continue; }
    if (r.source === "cardmarket" && r.variant === "average") { if (r.updated_day >= cmSince) get(r.card_id).cmEur = lastPriced(p); continue; }
    if (r.source === REF_ALT_SOURCE && r.variant === "average") { if (r.updated_day >= cmSince) get(r.card_id).cmEurAlt = lastPriced(p); continue; }
    if (r.source === "tcgplayer" && r.currency === "USD" && p.some((v) => v != null)) get(r.card_id).series.push({ variant: r.variant, startDay: r.start_day, prices: p });
  }
  if (rs.length < 5000) break;
}
for (const l of await q("SELECT card_id, variant, low_usd FROM listing_lows WHERE game = 'mtg' AND day >= ?", [addDays(day, -3)])) {
  const d = data.get(l.card_id);
  if (d && l.low_usd > 0) d.lows = { ...(d.lows ?? {}), [l.variant]: Number(l.low_usd) };
}
const since = addDays(day, -EBAY_REFEREE.maxAgeDays);
for (const r of await q("SELECT card_id, variant, n, n_nm, median_usd, q75_usd, vintage, day, manual, manual_price FROM ebay_asks WHERE game = 'mtg' AND (day >= ? OR manual IS NOT NULL)", [since])) {
  const d = data.get(r.card_id);
  if (!d) continue;
  const reading = r.day >= since ? { n: Number(r.n), nNm: Number(r.n_nm), median: r.median_usd == null ? null : Number(r.median_usd), q75: r.q75_usd == null ? null : Number(r.q75_usd), vintage: Number(r.vintage) === 1 } : null;
  d.asks = { ...(d.asks ?? {}), [r.variant]: { reading, manual: r.manual === "hide" || r.manual === "keep" ? r.manual : null, manualPrice: r.manual_price == null ? null : Number(r.manual_price) } };
}

const hits = [];
let flaggedTiles = 0;
const missing = { backup: [], eur: [] };
for (const [id, m] of meta) {
  const d = data.get(id);
  const judged = (d?.series ?? []).map((s) => ({ ...s, ...judgeFull(d, { variant: s.variant, exact: true, day }) }));
  const prices = cp.variantPrices("mtg", judged, day);
  if (prices.length === 0 && !cp.lastRecordedPrice("mtg", judged, day)) {
    // Not on its set list today (loadSetCards `continue`), while its own page prints a stored backup or the euro figure.
    if (hasBackup.has(id)) missing.backup.push(m.name);
    else if (m.eur.nonfoil || m.eur.foil) missing.eur.push(`${m.name} EUR ${m.eur.nonfoil || m.eur.foil}`);
  }
}
console.log(`mtg not on their set list, page prints a number: stored backup ${missing.backup.length}, euro figure only ${missing.eur.length}`);
console.log("  backup e.g.:", missing.backup.slice(0, 8).join("; "));
console.log("  euro e.g.:", missing.eur.slice(0, 8).join("; "));
for (const [id, d] of data) {
  if (d.series.length === 0) continue;
  const judged = d.series.map((s) => ({ ...s, ...judgeFull(d, { variant: s.variant, exact: true, day }) }));
  const prices = cp.variantPrices("mtg", judged, day);
  if (prices.length === 0 || cp.headlinePrice(prices)) continue;
  flaggedTiles++;
  if (hasBackup.has(id)) continue;
  const eur = d.eur?.nonfoil || d.eur?.foil;
  if (!eur) continue;
  hits.push({ name: meta.get(id).name, eur, flagged: prices.map((p) => `${p.variant} $${p.price} (${p.flag?.reason ?? "-"})`).join(" | ") });
}
console.log(`mtg: ${data.size} cards with series; set-list tiles flagged (no headline): ${flaggedTiles}; of those with no stored backup but a Cardmarket euro price (list says "looks off", page prints a number): ${hits.length}`);
for (const h of hits.sort((a, b) => b.eur - a.eur).slice(0, 25)) console.log(`  EUR ${h.eur}  ${h.name}  ${h.flagged}`);
