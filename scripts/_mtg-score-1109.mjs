// Read-only: score candidate Magic flat-step thresholds on the 11-07/11-08 hand labels, then show what the rule would leave in the live pool.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const { stepJump, STEP_JUMP } = await import("../src/lib/server/priceTrust.ts");
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const dayMs = (d) => Date.parse(d + "T00:00:00Z");
const load = async (id) => {
  const s = (await db.execute({ sql: "SELECT start_day, prices FROM price_series WHERE card_id = ? AND game='mtg' AND source='tcgplayer' AND currency='USD' AND variant='nonfoil'", args: [id] })).rows[0];
  return { start: s.start_day, prices: JSON.parse(s.prices) };
};
const cut = ({ start, prices }, day) => prices.slice(0, Math.round((dayMs(day) - dayMs(start)) / 864e5) + 1);
const flagged = (p, T, days = 7) => {
  const up = stepJump({ prices: p, days }, T);
  if (up.jump) return `UP ${up.reason}`;
  const down = stepJump({ prices: p.map((v) => (v == null ? null : 1 / v)), days }, T);
  return down.jump ? `DOWN ${down.reason}` : "";
};
const patch = (s, from, to, v) => { for (let i = 0; i < s.prices.length; i++) { const d = new Date(dayMs(s.start) + i * 864e5).toISOString().slice(0, 10); if (d >= from && d <= to) s.prices[i] = v; } return s; };
const labels = [
  ["F", "Veteran Bodyguard", "8d693da0-039d-462b-a5cb-d2bb179df65e", "2026-11-08"],
  ["F", "Lifeforce", "3715abe2-5a8e-4bf4-ac02-6c755d86bb4c", "2026-11-08"],
  ["F", "Vesuvan", "408ec348-183b-43de-abac-7ae9e3843c10", "2026-11-08"],
  ["F", "Zodiac Horse", "fb24cb19-3409-45f7-b0e0-7c652064d2dd", "2026-11-08"],
  ["F", "Blue Ward", "93f9f0f2-e1cc-4740-888c-1336c6de0a27", "2026-11-08"],
  ["F", "Howling Mine (cap step, price ok)", "c69d4007-d26b-442b-9c34-d3780c46c5f6", "2026-11-08"],
  ["F", "Twinning Staff (raw)", "5cdcc324-1427-453c-9940-c21f5d04c997", "2026-11-08", (s) => patch(s, "2026-11-04", "2026-11-08", 10)],
  ["F", "Platinum Emperion (raw)", "b7919474-db2b-441a-b368-9e430ddf70ab", "2026-11-08", (s) => patch(s, "2026-11-05", "2026-11-08", 12.54)],
  ["?", "Watery Grave 11-07 (back to 16.02 next day)", "139b90cd-8272-457a-be32-1298145345be", "2026-11-07"],
  ["R", "Thassa List", "cc8f9e7c-b1e0-4548-a069-b51f11cd4ed4", "2026-11-08"],
  ["R", "Ulamog List", "aa0aadff-bc69-49fb-8d12-5b5e4cfa438d", "2026-11-08"],
];
const loaded = [];
for (const [lab, name, id, day, fn] of labels) { let s = await load(id); if (fn) s = fn(s); loaded.push({ lab, name, p: cut(s, day) }); }
for (const [band, flatDays, stepMin] of [[0.03, 30, 1.3], [0.03, 14, 1.3], [0.03, 7, 1.3], [0.05, 7, 1.3], [0.07, 7, 1.3], [0.1, 7, 1.3], [0.1, 10, 1.3], [0.1, 5, 1.3], [0.1, 7, 1.2]]) {
  const T = { ...STEP_JUMP, flatBand: band, flatDays, stepMin };
  const r = loaded.map((l) => ({ ...l, f: flagged(l.p, T) }));
  const tp = r.filter((x) => x.lab === "F" && x.f).length, fn = r.filter((x) => x.lab === "F" && !x.f).map((x) => x.name.split(" ")[0]), fp = r.filter((x) => x.lab === "R" && x.f).map((x) => x.name.split(" ")[0]);
  console.log(`band ${band} flat ${flatDays} step ${stepMin}: caught ${tp}/${r.filter((x) => x.lab === "F").length} missed [${fn}] wrongly flagged real [${fp}]`);
}
const T = { ...STEP_JUMP, flatBand: 0.1, flatDays: 7 };
console.log("\nchosen (band .1, 7d):"); for (const l of loaded) console.log(" ", l.lab, l.name, "=>", flagged(l.p, T) || "pass");
for (const day of ["2026-11-07", "2026-11-08", "2026-11-09"]) {
  const rows = (await db.execute({ sql: "SELECT p.card_id, p.start_day, p.prices, m.name, m.set_code, m.collector_number FROM mtg_cards m JOIN price_series p ON p.card_id = m.id AND p.game='mtg' AND p.source='tcgplayer' AND p.currency='USD' AND p.updated_day >= ? WHERE p.variant='nonfoil' AND m.price_usd >= 5", args: [new Date(dayMs(day) - 3 * 864e5).toISOString().slice(0, 10)] })).rows;
  let stale = 0, moves = 0, big = 0, flat = 0; const left = [];
  for (const r of rows) {
    const all = JSON.parse(r.prices); const idx = Math.round((dayMs(day) - dayMs(r.start_day)) / 864e5);
    const p = all.slice(0, idx + 1); while (p.length <= idx) p.push(null);
    let last = idx; while (last >= 0 && p[last] == null) last--;
    if (last < 0) continue;
    if (idx - last > 3) { stale++; continue; }
    const to = p[last];
    let from = null; for (let i = idx - 7; i >= Math.max(0, idx - 10) && from == null; i--) from = p[i] ?? null;
    if (from == null || Math.min(from, to) < 10) continue;
    const pct = (to - from) / from * 100; if (Math.abs(pct) < 15) continue;
    moves++; if (Math.abs(pct) >= 25) big++;
    const f = flagged(p, T);
    if (f) { flat++; continue; }
    left.push({ n: `${r.name} | ${r.set_code} ${r.collector_number}`, from, to, pct, tail: p.slice(-12).map((v) => v ?? ".").join(" ") });
  }
  console.log(`\n${day}: pool ${rows.length}, stale last point ${stale}, moves 15%+ ${moves} (25%+ ${big}), flat-step flagged ${flat}, left ${left.length}`);
  if (day === "2026-11-09") for (const l of left.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 25)) console.log(`  ${l.n} ${l.from}->${l.to} ${l.pct.toFixed(0)}% | ${l.tail}`);
}
process.exit(0);
