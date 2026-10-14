// Read-only: how many catalog cards have our own saved picture, per game, on live Turso. 10-13.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const q = async (sql) => (await c.execute(sql)).rows;
console.log("mtg", await q("SELECT COUNT(*) total, SUM(own_image_url <> '' AND own_image_url IS NOT NULL) own, SUM((own_image_url = '' OR own_image_url IS NULL) AND image_url LIKE '%scryfall%') scryfall_left FROM mtg_cards"));
console.log("tcg", await q("SELECT game, COUNT(*) total, SUM(own_image_url <> '' AND own_image_url IS NOT NULL) own FROM tcg_cards GROUP BY game"));
console.log("pokemon", await q("SELECT COUNT(*) total, SUM(own_image_url <> '' AND own_image_url IS NOT NULL) own FROM en_cards"));
