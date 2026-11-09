// Read-only: the Magic gains still left after the flat-step rule, with how many days in the week the price actually changed.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const ids = [
  ["F no sales 45->71, NM 49-58", "8fc5a3d7-4d5f-4e02-9d00-b9cf5e5cd269"],
  ["? Earth Crystal, many sales 16-19", "9240303a-73a3-4daf-b5fc-090ce7cbd92a"],
  ["F Guan Yu one sale 76", "8fa7526a-7a4e-4b3d-b96e-91f2bbf1c7bd"],
  ["F Meekstone last sale 10-06", "2d1ced0f-a232-4a05-aa59-6e611b52d617"],
  ["F Dandan one sale 29.99", "414d3cae-b8cf-4d53-bd6b-1aa83a828ba9"],
  ["F Two-Headed one sale 74.95", "67299451-5302-4639-a4bc-6109521a2c0c"],
  ["  Aesi", "673c21f8-02b6-4ac4-b2fc-df065b4ac662"],
  ["  Crypt Ghast", "60bebd79-f88c-44ef-8920-e19031bad1d6"],
  ["  Momo art", "b333c1ae-66db-4464-bb9b-8dadf87cf71f-s"],
  ["  Fated Firepower", "1bf3c2bb-2d4a-4449-a9e5-66cb070dfd9c"],
  ["  Stone Giant", "a2b5f545-a87d-4292-880f-5cd2f6755748"],
  ["  Mystic Denial", "1296ddc4-300d-44f6-95d8-1b392613d379"],
  ["  Fear LEA", "0cd927be-e63f-4371-a1d8-7a0489cb187e"],
  ["  Super Shredder", "37a497b8-e908-4ddc-996e-a8470df72afb"],
  ["R Thassa (drop)", "cc8f9e7c-b1e0-4548-a069-b51f11cd4ed4"],
  ["R Nivea (drop)", "9a845742-a20d-4332-aaa8-d6cd2d5f482b"],
  ["R Twinflame (drop)", "1eb34f51-0bd2-43c3-af95-2ce8dabcc7bb"],
];
for (const [lab, id] of ids) {
  const s = (await db.execute({ sql: "SELECT prices FROM price_series WHERE card_id = ? AND game='mtg' AND source='tcgplayer' AND currency='USD' AND variant='nonfoil'", args: [id] })).rows[0];
  const p = JSON.parse(s.prices).slice(-14);
  const last8 = p.slice(-8).filter((v) => v != null);
  let changes = 0;
  for (let i = 1; i < last8.length; i++) if (last8[i] !== last8[i - 1]) changes++;
  console.log(`${String(changes).padStart(1)} changes in 7d | ${lab.padEnd(34)} | ${p.map((v) => v ?? ".").join(" ")}`);
}
process.exit(0);
