// One-off 10-21 ~3:45am ET (TASKS B.8 data side): three keeps from the 10-18 eBay sold checks were bound to the referee's
// older read instead of the price the check confirmed (TO-TEST 10-18 "Hidden by eBay" block), so they stopped binding and
// the pages went blank. Point each keep at the checked price. Prior manual_price kept in the log for undo.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const SET = [
  ["pokemon", "ex13-103", "holofoil", 6887.5], // Mewtwo Star HP 103: was 9200
  ["pokemon", "ex4-3", "holofoil", 290], // Team Aqua's Kyogre: was 542.6
  ["pokemon", "ex5-8", "reverseHolofoil", 118.21], // Jirachi HL 8 rev: was 151
];
const go = process.argv.includes("--go");
for (const [g, id, v, p] of SET) {
  const before = (await c.execute({ sql: "SELECT manual, manual_price FROM ebay_asks WHERE game = ? AND card_id = ? AND variant = ?", args: [g, id, v] })).rows[0];
  if (!go) { console.log("DRY", id, v, JSON.stringify(before), "->", p); continue; }
  const r = await c.execute({ sql: "UPDATE ebay_asks SET manual_price = ? WHERE game = ? AND card_id = ? AND variant = ? AND manual = 'keep'", args: [p, g, id, v] });
  console.log(id, v, JSON.stringify(before), "->", p, "rows", r.rowsAffected);
}
