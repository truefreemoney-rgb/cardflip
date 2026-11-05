import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const v = String((await db.execute("SELECT value FROM settings WHERE key='board'")).rows[0].value);
const secs = JSON.parse(v); const c = secs.find(s => /^completed$|^done/i.test(s.title.trim()));
c.items.unshift({ id: "x", done: true, owner: null, text: "Social autopilot test ".repeat(30), completedAt: Date.now() });
let json = JSON.stringify(secs); const moved = [];
while (c.items.length && json.length > 200000 * 0.8) { moved.push(c.items.pop()); json = JSON.stringify(secs); }
const et = ms => new Date(ms).toLocaleDateString("en-US", { timeZone: "America/New_York" });
console.log("after", json.length, "kept", c.items.length, "moved", moved.length, "oldest moved", et(moved[0]?.completedAt), "newest moved", et(moved.at(-1)?.completedAt), "oldest kept", et(c.items.at(-1)?.completedAt));
console.log("sample texts:", c.items.slice(0,3).map(i => i.text.slice(0,70)));