// One-off: 10-20 midday/evening kinds that need no weekly move (CAP_PAUSES made movers/sleepers empty -> games fallback x3).
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const r = await c.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: ["social_schedule"] });
const list = JSON.parse(r.rows[0].value);
const e = list.find((x) => x.from === "2026-10-20");
console.log("before", JSON.stringify(e));
e.midday = "guess"; e.middayGame = "lorcana"; e.evening = "set"; delete e.eveningGame;
await c.execute({ sql: "UPDATE settings SET value = ? WHERE key = ?", args: [JSON.stringify(list), "social_schedule"] });
const back = JSON.parse((await c.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: ["social_schedule"] })).rows[0].value).find((x) => x.from === "2026-10-20");
console.log("after ", JSON.stringify(back));
