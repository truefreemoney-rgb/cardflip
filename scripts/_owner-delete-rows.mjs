// Owner-only row delete, same three steps as deleteCards() in lib/server/cards.ts (photos, card_removals log, row),
// for Chris's OWN account only (10-30 #21: 4 Sylveon rows that were TCG Pocket screen shots, his yes 11:32pm ET).
// node scripts/_owner-delete-rows.mjs <cardId>... [--dry]
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const dry = process.argv.includes("--dry");
const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const owner = (await db.execute({ sql: "SELECT id FROM users WHERE email = ?", args: ["truefreemoney@gmail.com"] })).rows[0]?.id;
if (!owner || !ids.length) throw new Error("no owner or no ids");
const marks = ids.map(() => "?").join(", ");
const where = `user_id = ? AND status != 'sold' AND NOT (ebay_listing_id IS NOT NULL AND ebay_ended_at IS NULL) AND id IN (${marks})`;
const rows = (await db.execute({ sql: `SELECT id, card_name, set_name, card_number, status FROM cards WHERE ${where}`, args: [owner, ...ids] })).rows;
for (const r of rows) console.log("will delete:", r.id, r.card_name, r.set_name, r.card_number, r.status);
if (rows.length !== ids.length) throw new Error(`only ${rows.length} of ${ids.length} ids are the owner's unsold rows; nothing done`);
if (dry) { console.log("dry run: nothing written"); process.exit(0); }
await db.execute({ sql: `DELETE FROM card_photos WHERE card_id IN (SELECT id FROM cards WHERE ${where})`, args: [owner, ...ids] });
await db.execute({
  sql: `INSERT INTO card_removals (card_id, user_id, at, how, game, card_name, set_name, card_number, catalog_card_id, status, match_doubt, verified_at, created_at, client_id)
        SELECT id, user_id, ?, 'bulk', game, card_name, set_name, card_number, catalog_card_id, status, match_doubt, verified_at, created_at, client_id FROM cards WHERE ${where}`,
  args: [Date.now(), owner, ...ids],
});
const r = await db.execute({ sql: `DELETE FROM cards WHERE ${where}`, args: [owner, ...ids] });
console.log(`deleted ${r.rowsAffected}`);
db.close();
