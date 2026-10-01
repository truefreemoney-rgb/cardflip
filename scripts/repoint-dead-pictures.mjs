// Catalog rows whose picture link is dead get another printing's picture.
//
//   node scripts/sweep-picture-links.mjs --game yugioh    (first: refreshes scripts/dead-pictures-yugioh.json)
//   node scripts/repoint-dead-pictures.mjs [--prod] [--dry] [--game yugioh]
//
// The rule is scripts/lib/deadPictureStandIns.mjs. Writes the local mirror
// always, Turso with --prod (.env.migration.json), each only where the row
// still carries the dead link. Logged to backups/pictures-repointed-<date>.json;
// the rows with no same-name printing are listed (a brand-new set TCGplayer
// has not photographed yet: the next sweep picks them up once it has).
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { deadPictureStandIns } from "./lib/deadPictureStandIns.mjs";

const root = process.cwd();
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const game = arg("--game", "yugioh");
const dry = process.argv.includes("--dry");
const local = createClient({ url: "file:data/cardflip.db" });
let prod = null;
if (process.argv.includes("--prod")) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, ".env.migration.json"), "utf8").replace(/^﻿/, ""));
  prod = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
}

const dead = new Set(JSON.parse(fs.readFileSync(path.join(root, "scripts", `dead-pictures-${game}.json`), "utf8")));
const rows = (await local.execute({ sql: "SELECT id, name, variant, image_url, set_code, collector_number, set_release_date FROM tcg_cards WHERE game = ?", args: [game] })).rows;
const standIns = deadPictureStandIns(rows, dead);
const deadRows = rows.filter((r) => dead.has(r.image_url));
console.log(`${game}: ${deadRows.length} rows with a dead picture, ${standIns.size} have a stand-in, ${deadRows.length - standIns.size} have none`);

const log = [];
const sql = "UPDATE tcg_cards SET image_url = ? WHERE id = ? AND image_url = ?";
const statements = [];
for (const r of deadRows) {
  const url = standIns.get(r.id);
  if (!url) continue;
  log.push({ id: r.id, was: r.image_url, url });
  statements.push({ sql, args: [url, r.id, r.image_url] });
}
if (!dry) {
  for (let i = 0; i < statements.length; i += 200) {
    const chunk = statements.slice(i, i + 200);
    await local.batch(chunk, "write");
    if (prod) await prod.batch(chunk, "write");
  }
  if (log.length) fs.writeFileSync(path.join(root, "backups", `pictures-repointed-${game}-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(log, null, 1));
}
const none = deadRows.filter((r) => !standIns.has(r.id));
const bySet = {};
for (const r of none) bySet[r.set_code] = (bySet[r.set_code] ?? 0) + 1;
console.log(`${dry ? "would repoint" : "repointed"} ${log.length}${prod ? " (local + prod)" : " (local)"}; no stand-in: ${none.length} (${Object.entries(bySet).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(", ")})`);
