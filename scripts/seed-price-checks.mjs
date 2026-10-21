// Hand eBay sold checks (lib/server/checkedPrices.ts): records each check and fixes the trailing wrong stretch of its
// TCGplayer series now (the nightly writers keep it fixed from then on). Local db by default; --prod = Turso
// (.env.migration.json); --dry = print before/after, write nothing.
// node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/seed-price-checks.mjs [--prod] [--dry]
import fs from "node:fs";
import { createClient } from "@libsql/client";

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { correctTail } = await import(at("lib/server/checkedPrices.ts"));
const { todayUtc } = await import(at("lib/priceSeries.ts"));

const prod = process.argv.includes("--prod");
const dry = process.argv.includes("--dry");
const c = prod
  ? (() => {
      const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
      return createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
    })()
  : createClient({ url: "file:data/cardflip.db" });

const DAY = "2026-10-18";
// eBay sold, raw only (no slabs), checked by hand in the pane 10-18.
const CHECKS = [
  { game: "pokemon", cardId: "xy0-26", variant: "normal", usd: 43, n: 3, note: "Snorlax Kalos Starter Set: NM sold 42.42/45/45.44, LP 25-30; TCGplayer 64.88" },
  { game: "pokemon", cardId: "gym2-3-1st", variant: "1stEditionHolofoil", usd: 200, n: 0, note: "Brock's Ninetales 1st Ed: NM sold steady 175-255 for two months; TCGplayer 260.50" },
  { game: "pokemon", cardId: "hgssp-HGSS17", variant: "holofoil", usd: 23.33, n: 5, note: "Minun HGSS17: NM sold 23.33 x5 this week, 29.99; TCGplayer 39.25 (79.95 before)" },
  { game: "pokemon", cardId: "bw10-105", variant: "holofoil", usd: 122, n: 9, note: "Rare Candy Plasma Blast 105: Oct sold 66.64-149.99, median 121.99; TCGplayer 191.88 flat for months" },
  // 10-18 ~11:30am ET task sweep: card pages that were blank ("looks off") or stale-low.
  { game: "pokemon", cardId: "base1-4", variant: "holofoil", usd: 600, n: 8, note: "Charizard Base Set 4/102 unlimited: NM-labelled sold 507.35/657.86 (1,100 x2 outlier), clean 600/600/500, LP 479/610 this week; TCGplayer 954.65 (page showed looks off)" },
  { game: "pokemon", cardId: "base5-4-1st", variant: "1stEditionHolofoil", usd: 700, n: 16, note: "Dark Charizard 1st Ed holo 4/82: Oct raw sold 400-1,250, middle ~700 (NM 1,000-1,245); TCGplayer 121.94 flat then 62.35 (10-17 1pm post said -49%)" },
  // 10-18 ~12:30pm ET: /admin/prices "Hand check" queue, most valuable first (batch 1).
  { game: "lorcana", cardId: "crd_6d3607ca39714e16869a708fb3484460", variant: "foil", usd: 3000, n: 5, note: "Mickey Mouse Best in Town Iconic 241 Hyperia City: sold 2,500-3,500 on 10-16/17 (5); ours 7,500" },
  { game: "lorcana", cardId: "crd_86d5ec9aed56412294093be47d5dd44e", variant: "foil", usd: 550, n: 12, note: "Ariel Collector of Oddities Enchanted 236: 12 sold 10-15..18, 349-636, falling; ours 1,112.48" },
  { game: "lorcana", cardId: "crd_005aa953b56d427ebc078976dde6cb49", variant: "foil", usd: 420, n: 1, note: "Aurora Delightful Musician Enchanted 223: sold 420 (10-14), 9 NM asks median 399.81; ours 634" },
  { game: "lorcana", cardId: "crd_a08f2f0c29614d0c908f98b6468ee985", variant: "foil", usd: 134, n: 5, note: "Thomas O'Malley Enchanted 235: 5 English sold 125-140 (10-16/17); ours 515" },
  { game: "pokemon", cardId: "ex11-16", variant: "holofoil", usd: 255, n: 5, note: "Tyranitar delta 16/113 holo: NM/clean sold 200, 225, 255, 325, 792 (median 255); ours 370.74" },
  { game: "pokemon", cardId: "sm8-227", variant: "holofoil", usd: 245, n: 9, note: "Lugia GX 227/214: Oct raw sold 170-300 (NM ~240-300), one 850 outlier; ours 370.07" },
  { game: "pokemon", cardId: "ex10-117", variant: "holofoil", usd: 866, n: 19, note: "Celebi ex 117/115: 19 raw sold Aug-Oct 225-2,625, median 866, LP ~1,200; ours 370 was LOW (asks mismatched)" },
  { game: "pokemon", cardId: "pop4-13", variant: "holofoil", usd: 45, n: 20, note: "Pikachu POP Series 4 13/17 holo: ~20 sold 30-70 (big swirls 250-400); ours 369.63" },
  // Batch 2 (queue re-ranked against today's prices).
  { game: "pokemon", cardId: "ex13-10", variant: "reverseHolofoil", usd: 92, n: 18, note: "Kingdra delta 10/110 reverse: 18 non-damaged sold Aug-Oct 39-247, median 92; ours 289.10" },
  { game: "pokemon", cardId: "dp3-3", variant: "reverseHolofoil", usd: 200, n: 6, note: "Charizard Secret Wonders 3/132 reverse: NM/mint sold 150-260 (median 200), LP 100-150; ours 310.62" },
  { game: "mtg", cardId: "49852fa3-272c-4ca4-b0dc-0b80f2982fd9", variant: "foil", usd: 174, n: 2, note: "Spectacular Spider-Man #238 textured foil: sold 145.97 (09-25), 202.50 (09-23); ours 252.25" },
  { game: "yugioh", cardId: "ygo-22327-1st", variant: "normal", usd: 107, n: 8, note: "Raigeki LOB-053 1st: sold 37-152 Aug-Oct, better copies (NA glossy, VLP) 125-152, upper-half median 107; ours 218.95 above every sale" },
  // "Hidden by eBay" (the page said "looks off"): a checked price instead of a blank.
  { game: "pokemon", cardId: "sm3-150", variant: "holofoil", usd: 350, n: 10, note: "Charizard GX 150/147 rainbow: 10 non-played sold Sep-Oct 199-1,000 (median 292, upper half 350); TCGplayer 710.65 (hidden)" },
  { game: "yugioh", cardId: "ygo-38633", variant: "normal", usd: 2, n: 0, note: "Genex Ally Axel STBL-EN099: no exact sale; other prints sold 1.50-1.74, STBL secret rares 1.90-4.83; TCGplayer 213,589.17 (junk, hidden)" },
  { game: "yugioh", cardId: "ygo-92623", variant: "normal", usd: 1.25, n: 0, note: "Bujingi Crane MP14-EN073: 4 asks median 1.12; TCGplayer 199,379.19 (junk, hidden)" },
  { game: "yugioh", cardId: "ygo-476972", variant: "normal", usd: 1.5, n: 0, note: "Tower of Babel IOC-EN050 (Worldwide English): 44 asks median 1.39; TCGplayer 5,019.94 (junk, hidden)" },
  { game: "pokemon", cardId: "hgss1-123", variant: "reverseHolofoil", usd: 170, n: 6, note: "Gyarados HGSS 123 reverse: sold 85-200 in Oct (199.99 MP-LP, 200, 175, 160, 100, 85), median ~167; TCGplayer 499.99 (hidden)" },
  { game: "pokemon", cardId: "basep-1", variant: "holofoil", usd: 42, n: 9, note: "Pikachu Wizards Black Star Promo 1: NM sold 38-56 (median 42), LP 20-31; TCGplayer 499.99 (hidden)" },
  // Retro Pack / Premium Pack reprints with junk TCGplayer numbers (hidden); under $20, many consistent NM asks are the evidence.
  { game: "yugioh", cardId: "ygo-78081", variant: "normal", usd: 15, n: 0, note: "Red-Eyes B. Dragon RP01-EN011: 29 asks median 15 (q75 24.73); TCGplayer 679.99" },
  { game: "yugioh", cardId: "ygo-90819", variant: "normal", usd: 2.66, n: 0, note: "Hecatrice PP02-EN019: 48 asks median 2.66; TCGplayer 196.69" },
  { game: "yugioh", cardId: "ygo-78160", variant: "normal", usd: 12.74, n: 0, note: "Scapegoat RP01-EN090: 27 asks median 12.74; TCGplayer 192.48" },
  { game: "yugioh", cardId: "ygo-78073", variant: "normal", usd: 11.5, n: 0, note: "Dark Magician RP01-EN003: 40 asks median 11.50; TCGplayer 145" },
  { game: "yugioh", cardId: "ygo-90821", variant: "normal", usd: 7.06, n: 0, note: "Sengenjin PP02-EN003: 30 asks median 7.06; TCGplayer 120" },
  { game: "yugioh", cardId: "ygo-90811", variant: "normal", usd: 3.99, n: 0, note: "Elemental HERO Heat PP02-EN007: 15 asks median 3.99; TCGplayer 249.99" },
  { game: "yugioh", cardId: "ygo-90812", variant: "normal", usd: 4.24, n: 0, note: "Elemental Hero Knospe PP02-EN005: 16 asks median 4.24; TCGplayer 103.38" },
  { game: "pokemon", cardId: "ex11-11", variant: "holofoil", usd: 48, n: 11, note: "Metagross delta 11/113 holo: originals sold 21-175 (median 48); dozens of 3-14 sales are 30th Celebration reprints; TCGplayer 175.94 (hidden)" },
  { game: "mtg", cardId: "98fba951-c5bb-497c-9292-ce1b2a1e1247", variant: "nonfoil", usd: 637, n: 2, note: "Blaze of Glory Alpha (lea-6): sold 578.99 PLD 09-05, 695 LP 09-02 (a clean copy is higher); TCGplayer 440.74 stopped 10-13" },
  // 10-18 ~12:45pm ET hidden list (s197).
  { game: "pokemon", cardId: "dp6-11", variant: "reverseHolofoil", usd: 55, n: 18, note: "Mewtwo Legends Awakened 11 reverse: Oct sold 20-83, LP-NM 50-83, MP 37-50; TCGplayer 309.82 (hidden)" },
  { game: "pokemon", cardId: "dpp-DP28", variant: "holofoil", usd: 100, n: 12, note: "Mewtwo LV.X DP28: Oct raw sold 29-115 (MP 99/100, LP 67, DMG 30-42; one 589.99 via Authenticity Guarantee left out); TCGplayer 278.48 (hidden)" },
  { game: "pokemon", cardId: "2016xy-7", variant: "holofoil", usd: 65, n: 6, note: "Scraggy McDonald's 2016 7/12 holo (EU): English sold 55.07/59.99/61.81/75.30/79.99, MP 39; TCGplayer 199.99 (hidden)" },
  // 10-20 ~3pm ET: tonight's 7pm Blender set spotlight (30th Classic Collection), eBay sold read in the pane, raw only.
  { game: "pokemon", cardId: "30th-c-001", variant: "holofoil", usd: 178, n: 11, day: "2026-10-20", note: "Charizard 30th Classic Collection 4/102: 11 raw sold 10-20 at 140-200 (median ~178), ACE 10 at 319 excluded; TCGplayer 143.88" },
  { game: "pokemon", cardId: "30th-c-029", variant: "holofoil", usd: 210, n: 10, day: "2026-10-20", note: "Crystal Lugia 30th Classic Collection 149/147: 10 English raw sold 10-19/20 at 175-300 (median ~210); TCGplayer 189" },
  // 10-20 ~11pm ET hidden list (s209), eBay sold in the pane, raw only.
  { game: "pokemon", cardId: "bw7-142", variant: "holofoil", usd: 100, n: 15, day: "2026-10-20", note: "Keldeo-EX full art 142/149: 15 raw sold 09-09..10-18 at 60-155 (median 99.99; damaged/HP/MP/Brazilian left out); TCGplayer 140.65 (hidden)" },
  { game: "pokemon", cardId: "col1-91", variant: "holofoil", usd: 50, n: 13, day: "2026-10-20", note: "Lightning Energy Call of Legends 91/95 (Ampharos): 13 NM/unlabelled raw sold 08-25..10-18 at 39.92-66.44 (median 50), LP 42-54.93; TCGplayer 116 (hidden)" },
];
// --only id,id: write just these checks (the others are already on prod).
const onlyArg = process.argv.indexOf("--only");
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(",")) : null;
if (only) CHECKS.splice(0, CHECKS.length, ...CHECKS.filter((k) => only.has(k.cardId)));

await c.execute(`CREATE TABLE IF NOT EXISTS price_checked (
    game TEXT NOT NULL,
    card_id TEXT NOT NULL,
    variant TEXT NOT NULL,
    usd REAL NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    day TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    tcg_usd REAL,
    tcg_day TEXT,
    off_day TEXT,
    PRIMARY KEY (game, card_id, variant)
  )`);

const today = todayUtc();
console.log(`${prod ? "PROD" : "local"}${dry ? " (dry run)" : ""}, today ${today}`);
for (const k of CHECKS) {
  const check = { ...k, day: k.day ?? DAY };
  const r = (await c.execute({ sql: "SELECT start_day, prices FROM price_series WHERE card_id = ? AND game = ? AND variant = ? AND source = 'tcgplayer' AND currency = 'USD'", args: [k.cardId, k.game, k.variant] })).rows[0];
  if (!r) {
    console.log(`  ${k.cardId} ${k.variant}: NO TCGplayer series, check recorded only`);
  }
  const prices = r ? JSON.parse(String(r.prices)) : [];
  const fixed = r ? correctTail(String(r.start_day), prices, check, today) : { prices, changed: false, raw: null };
  const n = fixed.prices.filter((v, i) => v !== prices[i]).length;
  console.log(`  ${k.cardId} ${k.variant} -> $${k.usd}: ${n} points fixed; tail ${JSON.stringify(prices.slice(-8))} -> ${JSON.stringify(fixed.prices.slice(-8))}`);
  if (dry) continue;
  await c.execute({
    sql: `INSERT OR REPLACE INTO price_checked (game, card_id, variant, usd, n, day, note, tcg_usd, tcg_day, off_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    args: [k.game, k.cardId, k.variant, k.usd, k.n, check.day, k.note, fixed.raw, fixed.raw == null ? null : today],
  });
  if (fixed.changed) {
    await c.execute({
      sql: "UPDATE price_series SET prices = ? WHERE card_id = ? AND game = ? AND variant = ? AND source = 'tcgplayer' AND currency = 'USD'",
      args: [JSON.stringify(fixed.prices), k.cardId, k.game, k.variant],
    });
  }
}
console.log(dry ? "dry run: nothing written" : "done");
