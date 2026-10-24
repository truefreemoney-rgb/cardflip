// Read-only dry run (10-24): what matchOnePiecePromos would change on prod today. Prod SELECT + tcgcsv reads.
// node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_op-promo-dryrun.mjs
import fs from "node:fs";
import { createClient } from "@libsql/client";
const { matchOnePiecePromos } = await import("../src/lib/server/tcgPriceRefresh.ts");
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const H = { headers: { "User-Agent": "CardFlip/1.0 (support@cardflip.io)" } };
const API = "https://tcgcsv.com/tcgplayer/68";
const g = (await (await fetch(`${API}/groups`, H)).json()).results.find((x) => x.name === "One Piece Promotion Cards");
const products = (await (await fetch(`${API}/${g.groupId}/products`, H)).json()).results;
const prices = (await (await fetch(`${API}/${g.groupId}/prices`, H)).json()).results;
const by = new Map();
for (const p of prices) if (p.marketPrice != null && p.marketPrice > 0) by.set(p.productId, { ...(by.get(p.productId) ?? {}), [p.subTypeName ?? "Normal"]: p.marketPrice });
const list = products.flatMap((p) => { const n = p.extendedData?.find((e) => e.name === "Number")?.value ?? ""; const pr = by.get(p.productId); return pr && p.name && n ? [{ name: p.name, number: n, prices: pr }] : []; });
const rows = (await db.execute("SELECT id, name, collector_number AS number, price_usd FROM tcg_cards WHERE game='onepiece' AND set_code='PROMO'")).rows;
const held = new Map(rows.map((r) => [r.id, r.price_usd]));
const pts = matchOnePiecePromos(rows.map((r) => ({ id: r.id, name: r.name, number: r.number })), list);
const moved = pts.filter((p) => held.get(p.id) !== p.usd);
const big = moved.filter((p) => { const h = held.get(p.id); return h == null || Math.abs(p.usd - h) / Math.max(h, 0.01) > 0.25; });
console.log(`promo rows ${rows.length}; matched ${pts.length}; price would move ${moved.length}; >25% or newly priced ${big.length}; newly priced ${big.filter((p) => held.get(p.id) == null).length}`);
for (const p of big.sort((a, b) => b.usd - a.usd).slice(0, 25)) console.log(`  ${p.id}  ${held.get(p.id)} -> ${p.usd}  ${rows.find((r) => r.id === p.id).name}`);
fs.writeFileSync("data/op-promo-dryrun-2026-10-24.json", JSON.stringify(big.map((p) => ({ ...p, held: held.get(p.id) })), null, 1));
