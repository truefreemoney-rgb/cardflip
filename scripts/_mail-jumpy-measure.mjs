// Read-only (prod SELECTs): the young-game weekly movers the Sunday mail would pick (campaignData.ts youngGameMovers,
// replayed here), each with the guard's verdict, its "few recent sales" note and how much the week zig-zagged.
// node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_mail-jumpy-measure.mjs yugioh [day]
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { judgeFull } = await import(at("lib/server/priceTrustSite.ts"));
const { decodePrices, todayUtc, addDays } = await import(at("lib/priceSeries.ts"));
const { lastPriced, REF_ALT_SOURCE, PRICE_TRUST } = await import(at("lib/server/priceTrust.ts"));
const { seriesCapBreak } = await import(at("lib/priceOutliers.ts"));

const game = process.argv[2] ?? "yugioh";
const day = process.argv[3] ?? todayUtc();
const q = async (sql, args = []) => (await c.execute({ sql, args })).rows;
const weekAgo = addDays(day, -7);
const dayIdx = (s) => Math.round((Date.parse(day + "T00:00:00Z") - Date.parse(s + "T00:00:00Z")) / 86_400_000);
const onDay = (s, d) => { const i = Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(s.startDay + "T00:00:00Z")) / 86_400_000); for (let k = Math.min(i, s.prices.length - 1); k >= Math.max(0, i - 3); k--) if (s.prices[k] != null) return s.prices[k]; return null; };

const rows = await q(
  `SELECT p.card_id, p.variant, p.start_day, p.prices, t.name, t.set_name, t.collector_number FROM price_series p JOIN tcg_cards t ON t.id = p.card_id
    WHERE p.game = ? AND p.source = 'tcgplayer' AND p.currency = 'USD' AND p.updated_day >= ? AND p.start_day <= ? AND t.image_url <> ''
      AND COALESCE(json_extract(p.prices, '$[#-1]'), json_extract(p.prices, '$[#-2]'), 0) >= 10 LIMIT 4000`,
  [game, addDays(day, -3), weekAgo],
);
const checked = new Set((await q("SELECT card_id FROM price_checked WHERE game = ? AND off_day IS NULL", [game]).catch(() => [])).map((r) => r.card_id));
const moves = [];
for (const r of rows) {
  if (checked.has(r.card_id)) continue;
  const s = { startDay: r.start_day, prices: decodePrices(r.prices) };
  if (weekAgo < (seriesCapBreak(s, game) ?? weekAgo)) continue;
  const to = onDay(s, day);
  const from = onDay(s, weekAgo);
  if (to == null || from == null || !(to > 0) || !(from > 0) || Math.min(to, from) < 10 || to === from) continue;
  const idx = dayIdx(s.startDay);
  const held = (i, v) => (s.prices[i] ?? s.prices[i - 1]) === v && (s.prices[i - 1] ?? s.prices[i]) === v;
  if (!held(Math.min(idx, s.prices.length - 1), to) || !held(Math.min(idx - 7, s.prices.length - 1), from)) continue;
  const p = ((to - from) / from) * 100;
  if (p <= 0) continue;
  // The last 14 days: distinct price changes and the widest swing, the "jumpy" signal (Cyber Dragon 499.96 -> 406.67 -> 799.51).
  const win = s.prices.slice(Math.max(0, idx - 13), idx + 1).filter((v) => v != null);
  let changes = 0;
  let turns = 0;
  for (let i = 1; i < win.length; i++) if (win[i] !== win[i - 1]) changes++;
  const steps = win.map((v, i) => (i ? Math.sign(v - win[i - 1]) : 0)).filter((x) => x !== 0);
  for (let i = 1; i < steps.length; i++) if (steps[i] !== steps[i - 1]) turns++;
  moves.push({ id: r.card_id, variant: r.variant, name: `${r.name} | ${r.set_name} ${r.collector_number}`, from, to, pct: Math.round(p * 10) / 10, changes, turns, swing: win.length ? Math.round((Math.max(...win) / Math.min(...win)) * 100) / 100 : 1, win });
}
moves.sort((a, b) => b.pct - a.pct);
const top = moves.slice(0, 40);
// Trust data for the top, built as loadTrustData would (TCGplayer USD + Cardmarket refs + lows + asks).
const ids = [...new Set(top.map((m) => m.id))];
const data = new Map(ids.map((id) => [id, { game, series: [], cmEur: null, cmEurAlt: null, eur: null, released: "" }]));
const cmSince = addDays(day, -PRICE_TRUST.refMaxAgeDays);
for (const r of await q(`SELECT card_id, variant, source, start_day, prices, updated_day FROM price_series WHERE game = ? AND card_id IN (${ids.map(() => "?").join(",")})`, [game, ...ids])) {
  const d = data.get(r.card_id);
  const p = decodePrices(r.prices);
  if (r.source === "cardmarket" && r.variant === "average" && r.updated_day >= cmSince) d.cmEur = lastPriced(p);
  else if (r.source === REF_ALT_SOURCE && r.variant === "average" && r.updated_day >= cmSince) d.cmEurAlt = lastPriced(p);
  else if (r.source === "tcgplayer" && p.some((v) => v != null)) d.series.push({ variant: r.variant, startDay: r.start_day, prices: p });
}
for (const l of await q(`SELECT card_id, variant, low_usd FROM listing_lows WHERE game = ? AND day >= ? AND card_id IN (${ids.map(() => "?").join(",")})`, [game, addDays(day, -3), ...ids])) {
  const d = data.get(l.card_id);
  if (d && l.low_usd > 0) d.lows = { ...(d.lows ?? {}), [l.variant]: Number(l.low_usd) };
}
let shown = 0;
console.log(`${game} ${day}: ${moves.length} up-movers pass the mail's own checks; top 40 with the guard:`);
for (const m of top) {
  const v = judgeFull(data.get(m.id), { variant: m.variant, day });
  const tag = v.flag ? `FLAG(${v.flag.reason})` : v.stale?.few ? "FEW" : v.stale ? "STALE" : "ok";
  const picked = !v.flag && shown < 5 ? `#${++shown}` : "  ";
  console.log(`${picked} ${tag.padEnd(28)} +${m.pct}% ${m.from} -> ${m.to}  changes ${m.changes} turns ${m.turns} swing ${m.swing}  ${m.name} [${m.variant}]`);
  if (picked.trim()) console.log(`      14d: ${m.win.join(", ")}`);
}
