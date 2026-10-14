// Read-only sweep of questionable prices, all 5 games, against live Turso. 10-13.
import fs from 'node:fs';
const { siteTrustFull, trustKey } = await import("../src/lib/server/priceTrustSite.ts");
const { db } = await import("../src/lib/db.ts");
const { decodePrices, dayIndex } = await import("../src/lib/priceSeries.ts");
const out = { flags: [], stale: [], placeholder: [], repeated: [], firstBelowUnl: [], mtgOutlier: [], unreleased: [] };
const last = (s) => { const p = decodePrices(s.prices); for (let i = p.length - 1; i >= 0; i--) if (p[i] != null) return p[i]; return null; };
// latest TCGplayer-or-other value per card+variant
const series = await db.prepare(`SELECT card_id, game, variant, source, start_day, prices, updated_day FROM price_series`).all();
const latest = new Map();
for (const s of series) { const v = last(s); if (v == null) continue; const k = `${s.game}|${s.card_id}|${s.variant}`; const cur = latest.get(k); if (!cur || s.source === 'tcgplayer') latest.set(k, { game: s.game, id: s.card_id, variant: s.variant, source: s.source, v, upd: s.updated_day }); }
console.error('series', series.length, 'latest', latest.size);
const vals = [...latest.values()];
// 1. existing site trust on every price >= $10
const q = vals.filter((x) => x.v >= 10).map((x) => ({ cardId: x.id, game: x.game, variant: x.variant, liveUsd: x.v }));
for (let i = 0; i < q.length; i += 4000) {
  const r = await siteTrustFull(q.slice(i, i + 4000));
  for (const qq of q.slice(i, i + 4000)) {
    const k = trustKey(qq.cardId, qq.variant);
    const f = r.flags.get(k), st = r.stale.get(k);
    if (f) out.flags.push({ ...qq, reason: f.reason, hard: f.hard });
    else if (st) out.stale.push({ ...qq, days: st.days });
  }
  console.error('trust', Math.min(i + 4000, q.length), '/', q.length);
}
// 2. placeholder-looking values
for (const x of vals) if (x.v >= 20 && (/^(\d)\1*(\.\1\1)?$/.test(String(x.v).replace('.', '')) || [99.99, 999.99, 9999.99, 999, 9999, 5000, 10000, 1000, 99999].includes(x.v))) out.placeholder.push(x);
// 3. same price on many different cards of one set (copied price bug)
const tcg = await db.prepare(`SELECT id, game, name, set_name, price_usd, price_usd_foil, set_release_date FROM tcg_cards`).all();
const mtg = await db.prepare(`SELECT id, oracle_id, name, set_name, set_code, collector_number, promo_types, price_usd, price_usd_foil, price_usd_etched, set_release_date FROM mtg_cards`).all();
const grp = new Map();
for (const r of tcg) for (const v of [r.price_usd, r.price_usd_foil]) if (v >= 5) { const k = `${r.game}|${r.set_name}|${v}`; grp.set(k, [...(grp.get(k) ?? []), r.name]); }
for (const r of mtg) for (const v of [r.price_usd, r.price_usd_foil]) if (v >= 5) { const k = `mtg|${r.set_name}|${v}`; grp.set(k, [...(grp.get(k) ?? []), r.name]); }
for (const [k, names] of grp) { const u = new Set(names); if (u.size >= 4) out.repeated.push({ k, n: u.size, names: [...u].slice(0, 6) }); }
// 4. Yu-Gi-Oh 1st Edition priced below its Unlimited twin by a lot (or way above)
const byId = new Map(tcg.map((r) => [r.id, r]));
for (const r of tcg) if (r.game === 'yugioh' && r.id.endsWith('-1st')) { const u = byId.get(r.id.slice(0, -4)); if (u?.price_usd >= 5 && r.price_usd != null && r.price_usd < u.price_usd / 3) out.firstBelowUnl.push({ name: r.name, set: r.set_name, first: r.price_usd, unl: u.price_usd }); }
// 5. Magic printing >= 15x every other printing and >= $50, serial excluded
const byOracle = new Map();
for (const r of mtg) { const m = Math.max(r.price_usd ?? 0, r.price_usd_foil ?? 0, r.price_usd_etched ?? 0); if (m > 0 && r.oracle_id) byOracle.set(r.oracle_id, [...(byOracle.get(r.oracle_id) ?? []), { r, m }]); }
for (const list of byOracle.values()) { if (list.length < 2) continue; for (const a of list) { if (a.m < 50 || /serial/.test(a.r.promo_types ?? '')) continue; const others = Math.max(...list.filter((b) => b !== a).map((b) => b.m)); if (a.m >= 15 * others) out.mtgOutlier.push({ name: a.r.name, set: a.r.set_name, num: a.r.collector_number, price: a.m, othersMax: others, promo: a.r.promo_types }); } }
// 6. priced but not released yet
const today = new Date().toISOString().slice(0, 10);
for (const r of [...tcg.map((r) => ({ ...r, game: r.game })), ...mtg.map((r) => ({ ...r, game: 'mtg' }))]) if (r.set_release_date > today && (r.price_usd ?? r.price_usd_foil) >= 20) out.unreleased.push({ game: r.game, name: r.name, set: r.set_name, rel: r.set_release_date, price: r.price_usd ?? r.price_usd_foil });
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
const byGame = (a) => a.reduce((m, x) => ((m[x.game ?? 'mtg'] = (m[x.game ?? 'mtg'] ?? 0) + 1), m), {});
console.log({ trustChecked: q.length, flags: byGame(out.flags), stale: byGame(out.stale), placeholder: byGame(out.placeholder), repeated: out.repeated.length, firstBelowUnl: out.firstBelowUnl.length, mtgOutlier: out.mtgOutlier.length, unreleased: byGame(out.unreleased) });
process.exit(0);
