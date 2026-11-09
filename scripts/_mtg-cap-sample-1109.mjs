// Read-only: a random sample of Magic nonfoil prices pinned by capToListing today, with the uncapped Scryfall market, the listing low and mid.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl;
process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const { allListingLows } = await import("../src/lib/server/mtgTcgplayerFill.ts");
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const rows = (await db.execute(`SELECT m.id, m.name, m.set_code, m.collector_number, m.price_usd p, l.low_usd low
  FROM listing_lows l JOIN mtg_cards m ON m.id = l.card_id
  WHERE l.game='mtg' AND l.variant='nonfoil' AND l.day = (SELECT MAX(day) FROM listing_lows WHERE game='mtg')
    AND m.price_usd >= 10`)).rows;
const near = (a, b) => Math.abs(a - b) <= 0.011;
const pinned = rows.filter((r) => near(r.p, r.low) || near(r.p, Math.round(r.low * 145) / 100));
console.log("listing_lows nonfoil $10+ today", rows.length, "pinned to the low or 1.45x", pinned.length);
// A repeatable shuffle (seeded), 36 cards.
let s = 20261109; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const shuffled = pinned.map((r) => [rnd(), r]).sort((a, b) => a[0] - b[0]).map((x) => x[1]).slice(0, 36);
const res = await fetch("https://api.scryfall.com/cards/collection", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "user-agent": "CardFlipCheck/1.0" }, body: JSON.stringify({ identifiers: shuffled.map((r) => ({ id: r.id })) }) });
const data = (await res.json()).data ?? [];
const sc = new Map(data.map((c) => [c.id, c]));
const lows = await allListingLows();
const out = [];
for (const r of shuffled) {
  const c = sc.get(r.id); if (!c) continue;
  const l = lows.get(c.tcgplayer_id)?.Normal;
  out.push({ n: `${r.name} | ${r.set_code} ${r.collector_number}`, tcg: c.tcgplayer_id, shown: r.p, low: r.low, market: Number(c.prices.usd) || null, mid: l?.mid ?? null, liveLow: l?.low ?? null });
}
fs.writeFileSync("C:/Users/Chris/AppData/Local/Temp/claude/4f0625cbc2cf2b4f/3b0aea0b-c612-461c-9bd8-9110d682cb9f/scratchpad/cap-sample.json", JSON.stringify(out));
for (const o of out) console.log(`${o.n} | tcg ${o.tcg} | shown ${o.shown} low ${o.low} scryfall ${o.market} mid ${o.mid}`);
console.log(JSON.stringify(out.map((o) => o.tcg)));
process.exit(0);
