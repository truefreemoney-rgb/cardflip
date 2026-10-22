// Read-only (10-22 7:40am ET): did the 5:45am ET Pokémon write behave? node scripts/_write-1022-check.mjs [--prod]
// (1) retired eBay-set checks (off_day set) -> series tail at TCGplayer's number, updated today
// (2) the 15 Staff-stamp fixes + Entei/Rillaboom/Charizard SWSH066 -> checks still bind, tail not jumped back
// (3) every price_checked row with day 2026-10-22 -> still on (off_day NULL), tail == usd
import fs from "node:fs";
import { createClient } from "@libsql/client";
const prod = process.argv.includes("--prod");
const c = prod
  ? (() => { const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^ï»¿/, "")); return createClient({ url: cfg.dbUrl, authToken: cfg.dbToken }); })()
  : createClient({ url: "file:data/cardflip.db" });

async function tail(game, id, variant) {
  const r = await c.execute({ sql: "SELECT start_day, updated_day, prices FROM price_series WHERE card_id = ? AND game = ? AND variant = ? AND source = 'tcgplayer' AND currency = 'USD'", args: [id, game, variant] });
  if (!r.rows[0]) return null;
  const p = JSON.parse(String(r.rows[0].prices));
  return { upd: r.rows[0].updated_day, last: p[p.length - 1], prev: p[p.length - 2], n: p.length };
}
const name = async (game, id) => {
  const r = await c.execute({ sql: "SELECT name, set_name FROM cards WHERE game = ? AND id = ? LIMIT 1", args: [game, id] }).catch(() => ({ rows: [] }));
  return r.rows[0] ? `${r.rows[0].name} (${r.rows[0].set_name})` : id;
};

console.log("== (1) retired checks (off_day set), pokemon: series tail should be TCGplayer's, updated 2026-10-22");
const ret = await c.execute("SELECT game, card_id, variant, usd, off_day, tcg_usd FROM price_checked WHERE off_day IS NOT NULL AND game = 'pokemon'");
let stale = 0;
for (const r of ret.rows) {
  const t = await tail(r.game, r.card_id, r.variant);
  const ok = t && t.upd === "2026-10-22";
  if (!ok) stale++;
  console.log(`${ok ? "ok " : "!! "} ${r.card_id} ${r.variant} retired ${r.off_day} old check $${r.usd} -> tail ${t ? `$${t.last} (prev $${t.prev}, upd ${t.upd})` : "NO SERIES"}  ${await name(r.game, r.card_id)}`);
}
console.log(`retired pokemon rows: ${ret.rows.length}, not updated today: ${stale}`);

console.log("\n== (2) stamp fixes + named keeps");
const named = ["smp-SM219", "swshp-SWSH006", "swshp-SWSH066", "xyp-XY10", "xyp-XY129", "smp-SM11", "smp-SM48", "smp-SM47", "smp-SM130", "smp-SM131", "smp-SM132"];
for (const id of named) {
  const ck = await c.execute({ sql: "SELECT variant, usd, day, off_day, tcg_usd, tcg_day FROM price_checked WHERE game = 'pokemon' AND card_id = ?", args: [id] });
  const vs = ck.rows.length ? ck.rows : [{ variant: "normal" }];
  for (const k of vs) {
    const t = await tail("pokemon", id, String(k.variant));
    console.log(`${id} ${k.variant} check ${k.usd != null ? `$${k.usd} day ${k.day} off ${k.off_day ?? "-"} tcg ${k.tcg_usd}@${k.tcg_day}` : "none"} | tail ${t ? `$${t.last} (prev $${t.prev}, upd ${t.upd}, n ${t.n})` : "NO SERIES"}  ${await name("pokemon", id)}`);
  }
}

console.log("\n== (3) checks recorded 2026-10-22: still on, tail == usd");
const today = await c.execute("SELECT game, card_id, variant, usd, off_day FROM price_checked WHERE day = '2026-10-22'");
let bad = 0;
for (const r of today.rows) {
  const t = await tail(r.game, r.card_id, r.variant);
  const ok = r.off_day == null && t && Math.abs(Number(t.last) - Number(r.usd)) < 0.01;
  if (!ok) bad++;
  console.log(`${ok ? "ok " : "!! "} ${r.card_id} ${r.variant} check $${r.usd} off ${r.off_day ?? "-"} tail ${t ? `$${t.last} upd ${t.upd}` : "NO SERIES"}`);
}
console.log(`today's checks: ${today.rows.length}, not binding: ${bad}`);
