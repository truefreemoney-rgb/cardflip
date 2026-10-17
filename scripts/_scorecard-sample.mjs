// Read-only (prod SELECTs + public /api/price-history): weekly accuracy scorecard sample (#8, 10-17).
// 20 cards = 5 games x (2 at $5-50 + 2 at $50+), skipping cards used in earlier tests. What the site SHOWS today
// (a guard flag = no price shown). node scripts/_scorecard-sample.mjs <outDir>
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const outDir = process.argv[2];
fs.mkdirSync(outDir, { recursive: true });
const used = new Set();
for (const f of fs.readdirSync("docs/price-sim-2026-10-17").filter((f) => f.startsWith("sample-"))) {
  for (const s of JSON.parse(fs.readFileSync(path.join("docs/price-sim-2026-10-17", f), "utf8").replace(/^﻿/, ""))) used.add(s.id);
}
const BANDS = { low: [5, 50], high: [50, 100000] };
const JOIN = {
  pokemon: ["JOIN en_cards m ON m.id = s.card_id", "m.name, m.set_name, m.local_id AS num, '' AS rarity"],
  mtg: ["JOIN mtg_cards m ON m.id = s.card_id", "m.name, m.set_name, m.collector_number AS num, m.rarity"],
  lorcana: ["JOIN tcg_cards m ON m.id = s.card_id", "m.name, m.set_name, m.collector_number AS num, m.rarity"],
  onepiece: ["JOIN tcg_cards m ON m.id = s.card_id", "m.name, m.set_name, m.collector_number AS num, m.rarity"],
  yugioh: ["JOIN tcg_cards m ON m.id = s.card_id", "m.name, m.set_name, m.collector_number AS num, m.rarity"],
};
const out = [];
for (const [game, [join, cols]] of Object.entries(JOIN)) {
  const rs = (await c.execute({
    sql: `SELECT s.card_id, s.variant, s.prices, ${cols} FROM price_series s ${join}
           WHERE s.game = ? AND s.source = 'tcgplayer' AND s.currency = 'USD' AND s.updated_day >= date('now','-3 day')
             AND s.card_id NOT LIKE 'sealed-%' AND s.card_id NOT LIKE 'tcgp-sealed-%' ORDER BY random() LIMIT 3000`,
    args: [game],
  })).rows;
  for (const [band, [lo, hi]] of Object.entries(BANDS)) {
    let n = 0;
    for (const r of rs) {
      if (n >= 2) break;
      if (used.has(r.card_id)) continue;
      const p = JSON.parse(r.prices);
      let v = null;
      for (let i = p.length - 1; i >= 0 && v == null; i--) v = p[i];
      if (v == null || v < lo || v >= hi) continue;
      used.add(r.card_id);
      const h = await fetch(`https://cardflip.io/api/price-history?cardId=${encodeURIComponent(r.card_id)}`);
      const b = h.ok ? await h.json() : {};
      const ser = (b.series ?? []).find((x) => x.source === "tcgplayer" && x.variant === r.variant);
      const flag = ser?.untrusted ? ser.untrusted.reason : null;
      out.push({ game, band, id: r.card_id, variant: r.variant, name: r.name, set: r.set_name, num: r.num, rarity: r.rarity ?? "", series: v, shown: ser && !flag ? v : null, flag });
      n++;
      await new Promise((res) => setTimeout(res, 400));
    }
  }
}
fs.writeFileSync(path.join(outDir, "sample.json"), JSON.stringify(out, null, 1));
for (const s of out) console.log(`${s.game.padEnd(8)} ${s.band.padEnd(4)} ${String(s.shown ?? "FLAG").padStart(8)}  ${s.name} | ${s.set} | ${s.num} | ${s.rarity} | ${s.variant}${s.flag ? "  (" + s.flag + ")" : ""}`);
