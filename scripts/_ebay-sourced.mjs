// READ ONLY: every price that comes from eBay (Chris 10-21: "how many total ebay first cards are there").
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const q = async (s) => (await c.execute(s)).rows;
console.log("price_series eBay sources:", JSON.stringify(await q("SELECT source, game, COUNT(*) n FROM price_series WHERE source LIKE '%ebay%' GROUP BY source, game")));
console.log("active eBay checks:", JSON.stringify(await q("SELECT game, COUNT(*) n, SUM(CASE WHEN usd>=100 THEN 1 ELSE 0 END) usd100 FROM price_checked WHERE off_day IS NULL GROUP BY game")));
const cols = (await q("PRAGMA table_info(ebay_asks)")).map((r) => r.name);
console.log("ebay_asks cols:", cols.join(","));
console.log("ebay_asks rows:", JSON.stringify(await q("SELECT COUNT(*) n FROM ebay_asks")));
