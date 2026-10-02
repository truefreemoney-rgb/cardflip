// One-off helper (10-01): repoint-dead-pictures.mjs reads the LOCAL mirror, so a run without --prod
// leaves prod behind with nothing left for a later --prod run to find. This catches prod up: every
// prod row that still carries a dead link gets the picture the local row now shows.
//
//   node scripts/repoint-prod-from-local.mjs [--game yugioh]            (dry: lists)
//   node scripts/repoint-prod-from-local.mjs [--game yugioh] --write
//
// Only touches rows whose prod link is on scripts/dead-pictures-<game>.json and whose local link
// is not. Logged to backups/pictures-repointed-prod-<game>-<date>.json.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

const root = process.cwd();
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const game = arg("--game", "yugioh");
const write = process.argv.includes("--write");
const cfg = JSON.parse(fs.readFileSync(path.join(root, ".env.migration.json"), "utf8").replace(/^﻿/, ""));
const local = createClient({ url: "file:data/cardflip.db" });
const prod = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const dead = new Set(JSON.parse(fs.readFileSync(path.join(root, "scripts", `dead-pictures-${game}.json`), "utf8")));

const sqlRows = "SELECT id, name, image_url FROM tcg_cards WHERE game = ?";
const localUrl = new Map((await local.execute({ sql: sqlRows, args: [game] })).rows.map((r) => [r.id, r.image_url]));
const prodRows = (await prod.execute({ sql: sqlRows, args: [game] })).rows;
const log = [];
for (const r of prodRows) {
  const url = localUrl.get(r.id);
  if (dead.has(r.image_url) && url && url !== r.image_url && !dead.has(url)) log.push({ id: r.id, name: r.name, was: r.image_url, url });
}
console.log(`${game}: ${prodRows.filter((r) => dead.has(r.image_url)).length} prod rows with a dead picture, ${log.length} have a picture locally`);
for (const l of log) console.log(`  ${l.name} -> ${l.url.split("/").slice(-2).join("/")}`);
if (write && log.length) {
  await prod.batch(log.map((l) => ({ sql: "UPDATE tcg_cards SET image_url = ? WHERE id = ? AND image_url = ?", args: [l.url, l.id, l.was] })), "write");
  fs.writeFileSync(path.join(root, "backups", `pictures-repointed-prod-${game}-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(log, null, 1));
  console.log(`repointed ${log.length} on prod`);
}
