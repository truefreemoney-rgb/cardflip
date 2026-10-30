// Read-only (prod SELECTs): what the site price guard says about ONE printing right now, with its inputs. 10-29.
// node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_judge-one.mjs pokemon sv10.5b-093 holofoil 6.52
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl;
process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const site = await import(at("lib/server/priceTrustSite.ts"));
const { todayUtc } = await import(at("lib/priceSeries.ts"));
const [game = "pokemon", cardId, variant = "holofoil", live] = process.argv.slice(2);
const day = todayUtc();
const data = (await site.loadTrustData([{ cardId, game }], day)).get(cardId);
if (!data) { console.log("no trust data for", cardId); process.exit(0); }
const tail = (s) => s.prices.slice(-40).map((v) => (v == null ? "·" : v)).join(" ");
console.log("day", day, "cmEur", data.cmEur, "cmEurAlt", data.cmEurAlt, "released", data.released, "lows", data.lows, "asks", data.asks && Object.keys(data.asks), "checked", data.checked);
for (const s of data.series) console.log(`series ${s.variant} start ${s.startDay} n=${s.prices.length}:`, tail(s));
const liveUsd = live ? Number(live) : undefined;
console.log("judgeFull exact+live:", JSON.stringify(site.judgeFull(data, { day, variant, exact: true, liveUsd })));
console.log("judgeFull default:", JSON.stringify(site.judgeFull(data, { day })));
