import fs from 'node:fs';
const { db } = await import("../src/lib/db.ts");
const sw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const hidden = new Set(sw.flags.map((f) => `${f.cardId}`));
const tcg = await db.prepare(`SELECT id, game, name, set_name, price_usd u, price_usd_foil f, set_release_date rel FROM tcg_cards`).all();
const mtg = await db.prepare(`SELECT id, oracle_id, name, set_name, collector_number num, promo_types, price_usd u, price_usd_foil f, price_usd_etched e, set_release_date rel FROM mtg_cards`).all();
const ask = new Set(fs.readFileSync(process.argv[3], 'utf8').split('\n').map((l) => l.split(' | ').slice(0, 2).join('|')));
const shown = [];
const add = (game, r, price, why) => { if (!hidden.has(r.id)) shown.push({ game, id: r.id, name: r.name, set: r.set_name, num: r.num, price, why, askingOnlyYgo: ask.has(`${r.name}|${r.set_name}`) }); };
// big round / placeholder / copied
const cnt = new Map();
for (const r of [...tcg, ...mtg.map((m) => ({ ...m, game: 'mtg' }))]) for (const v of [r.u, r.f]) if (v >= 20) { const k = `${r.game}|${r.set_name}|${v}`; cnt.set(k, (cnt.get(k) ?? 0) + 1); }
for (const r of [...tcg, ...mtg.map((m) => ({ ...m, game: 'mtg' }))]) {
  const v = Math.max(r.u ?? 0, r.f ?? 0, r.e ?? 0);
  if (v >= 20 && (cnt.get(`${r.game}|${r.set_name}|${r.u}`) >= 4 || cnt.get(`${r.game}|${r.set_name}|${r.f}`) >= 4)) add(r.game, r, v, 'same price on 4+ cards in set');
  else if (v >= 50000) add(r.game, r, v, 'over $50k');
  else if (v >= 100 && r.rel > '2026-10-13') add(r.game, r, v, 'unreleased');
}
// ygo unlimited way above 1st (the 1st twin cheap)
const byId = new Map(tcg.map((r) => [r.id, r]));
for (const r of tcg) if (r.game === 'yugioh' && r.id.endsWith('-1st')) { const u = byId.get(r.id.slice(0, -4)); if (u?.u >= 50 && r.u != null && r.u < u.u / 5) add('yugioh', u, u.u, `unlimited ${u.u} vs 1st ${r.u}`); }
// mtg 15x outliers
const byO = new Map();
for (const r of mtg) { const m = Math.max(r.u ?? 0, r.f ?? 0, r.e ?? 0); if (m > 0 && r.oracle_id) byO.set(r.oracle_id, [...(byO.get(r.oracle_id) ?? []), { r, m }]); }
for (const l of byO.values()) if (l.length > 1) for (const a of l) { if (a.m < 100 || /serial/.test(a.r.promo_types ?? '')) continue; const o = Math.max(...l.filter((b) => b !== a).map((b) => b.m)); if (a.m >= 15 * o) add('mtg', a.r, a.m, `15x other printings (${o}) ${a.r.promo_types ?? ''}`); }
const uniq = [...new Map(shown.map((s) => [s.id, s])).values()].sort((a, b) => b.price - a.price);
fs.writeFileSync(process.argv[4], JSON.stringify(uniq, null, 1));
const by = {}; for (const s of uniq) { const k = `${s.game}: ${s.why.replace(/[\d.]+/g, 'N').replace(/\(N\).*/, '')}${s.askingOnlyYgo ? ' [asking-only, cleared by new rule]' : ''}`; by[k] = (by[k] ?? 0) + 1; }
console.log('shown on site, not hidden:', uniq.length); console.log(by);
for (const s of uniq.slice(0, 30)) console.log(`${s.game} | ${s.name} | ${s.set} ${s.num ?? ''} | $${s.price} | ${s.why}${s.askingOnlyYgo ? ' | ASK' : ''}`);
process.exit(0);
