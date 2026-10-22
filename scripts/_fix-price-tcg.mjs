// One-off fix of a caught wrong catalog price from TCGplayer's own Near Mint sales (TCGplayer first, 10-22). Same write
// as /api/admin/post-check "fix": putCheck + fixSeriesNow + drop the card's list caches.
// Run: node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_fix-price-tcg.mjs <game> <cardId> <variant> <usd> <n> "<note>"
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl;
process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const [game, cardId, variant, usdS, nS, note] = process.argv.slice(2);
const usd = Number(usdS), n = Number(nS ?? 0);
if (!game || !cardId || !variant || !(usd > 0) || !note) { console.error("usage: game cardId variant usd n note"); process.exit(2); }
const { putCheck, fixSeriesNow, storedRaw } = await import("../src/lib/server/checkedPrices.ts");
const { dropCardLists } = await import("../src/lib/server/cardPages.ts");
const { todayUtc } = await import("../src/lib/priceSeries.ts");
const before = await storedRaw(game, cardId, variant);
const check = { game, cardId, variant, usd: Math.round(usd * 100) / 100, n, day: todayUtc(), note };
await putCheck(check);
const fixed = await fixSeriesNow(check, todayUtc());
try { await dropCardLists(game, cardId); } catch {}
console.log(`${game} ${cardId} ${variant}: was $${before} -> checked $${check.usd} (n ${n}); series points fixed: ${fixed}`);
process.exit(0);
