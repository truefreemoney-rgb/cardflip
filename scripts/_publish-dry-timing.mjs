// Read-only: the morning publisher as a DRY run against prod (fake connected site, nothing posts or stores),
// with every query over 1 s logged, to see where a run's time goes (10-23, Turso slow).
// Run: node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_publish-dry-timing.mjs
import fs from "node:fs";
const env = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL = env.dbUrl;
process.env.TURSO_AUTH_TOKEN = env.dbToken;
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { db } = await import(at("lib/db.ts"));
const T0 = Date.now();
const stamp = () => `${((Date.now() - T0) / 1000).toFixed(1).padStart(6)} s`;
const prepare = db.prepare.bind(db);
db.prepare = (sql) => {
  const st = prepare(sql);
  const head = sql.replace(/\s+/g, " ").trim().slice(0, 110);
  for (const m of ["all", "get", "run"]) {
    const f = st[m]?.bind(st);
    if (!f) continue;
    if (m === "run") st.run = () => { throw new Error(`write refused in the dry probe: ${head}`); };
    else st[m] = async (...a) => { const s = Date.now(); try { return await f(...a); } finally { const ms = Date.now() - s; if (ms > 1000) console.log(stamp(), `${ms} ms`, head); } };
  }
  return st;
};
const { publishSocial } = await import(at("lib/server/socialPublish.ts"));
const site = { id: "probe", label: "probe", maxChars: 5000, maxImageBytes: 1_000_000, connected: () => true, async post() { throw new Error("dry"); } };
const r = await publishSocial({ slot: "morning", origin: "https://cardflip.io", sites: [site], dry: true, fetchImage: async () => Buffer.from("x") });
console.log(stamp(), "done", JSON.stringify(r).slice(0, 600));
process.exit(0);
