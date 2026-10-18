import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const since = Date.now() - 10 * 60 * 1000;
console.log("views last 10 min", JSON.stringify((await c.execute({ sql: "SELECT page, device, at FROM heat_views WHERE at > ?", args: [since] })).rows));
console.log("taps last 10 min", (await c.execute({ sql: "SELECT COUNT(*) n FROM heat_taps WHERE at > ?", args: [since] })).rows[0].n);
