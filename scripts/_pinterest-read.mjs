// READ ONLY (prod): can our stored Pinterest token list the account's pins? Prints no secrets.
//   node scripts/_pinterest-read.mjs
import { createClient } from "@libsql/client";
import fs from "node:fs";
const j = JSON.parse(fs.readFileSync(new URL("../.env.migration.json", import.meta.url), "utf8").replace(/^﻿/, ""));
const db = createClient({ url: j.dbUrl, authToken: j.dbToken });
const r = await db.execute({ sql: "SELECT value FROM settings WHERE key = 'social_token:pinterest'" });
const t = JSON.parse(String(r.rows[0]?.value ?? "null"));
if (!t) throw new Error("no pinterest token row");
console.log("scope", t.scope, "| access expires", new Date(t.expires_at).toISOString(), "| refresh expires", new Date(t.refresh_expires_at).toISOString());
if (t.expires_at < Date.now()) throw new Error("access token expired; not refreshing from here");
const fails = await db.execute("SELECT key, value FROM settings WHERE key LIKE 'social_slot:failed:pinterest%' OR key LIKE 'social_last_post:pinterest%'");
for (const f of fails.rows) console.log(f.key, "=", f.value);
for (const path of ["/v5/user_account", "/v5/pins?page_size=10&pin_metrics=true"]) {
  const res = await fetch(`https://api.pinterest.com${path}`, { headers: { authorization: `Bearer ${t.access_token}` } });
  const body = await res.text();
  console.log("\nGET", path, res.status);
  try {
    const b = JSON.parse(body);
    if (b.items) for (const p of b.items) console.log(p.id, p.created_at, p.board_id, JSON.stringify(p.title), p.media?.media_type, p.pin_metrics ? JSON.stringify(p.pin_metrics).slice(0, 200) : "");
    else console.log(JSON.stringify(b).slice(0, 400));
  } catch {
    console.log(body.slice(0, 300));
  }
}
