// Replace one day's standing social schedule entry on prod (the optimizer's own lever, lib/server/socialSchedule.ts).
// Run: node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_schedule-entry.mjs '<entry JSON>' [--dry]
// 10-25: the 7pm "price drops" (paused) fell back to a set spotlight whose week claims were the Pokémon cap lift.
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl;
process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const [raw, flag] = process.argv.slice(2);
const { addScheduleEntry, loadSchedule, parseSchedule } = await import("../src/lib/server/socialSchedule.ts");
const [entry] = parseSchedule(JSON.stringify([JSON.parse(raw)]));
if (!entry) { console.error("entry did not parse (kind/game not allowed?)"); process.exit(2); }
const before = (await loadSchedule()).find((e) => e.from === entry.from) ?? null;
console.log("before:", JSON.stringify(before));
console.log("after: ", JSON.stringify(entry));
if (flag === "--dry") process.exit(0);
const all = await addScheduleEntry(entry);
console.log("written; entries now", all.length, "last:", JSON.stringify(all[all.length - 1]));
process.exit(0);
