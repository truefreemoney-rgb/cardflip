// One-off (10-23, Turso slow): build today's fallback drafts locally against prod and add them to the stored day build
// (settings social_drafts:<game>:<day>), so a late publisher run finds them. The build itself is read-only (writes refused);
// the only write is that one settings row per game.
// Run: node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_seed-fallback-drafts.mjs
import fs from "node:fs";
const env = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL = env.dbUrl;
process.env.TURSO_AUTH_TOKEN = env.dbToken;
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { db } = await import(at("lib/db.ts"));
const prepare = db.prepare.bind(db);
let locked = true;
db.prepare = (sql) => {
  const st = prepare(sql);
  const run = st.run?.bind(st);
  if (run) st.run = (...a) => { if (locked) throw new Error(`write refused during the build: ${sql.slice(0, 80)}`); return run(...a); };
  return st;
};
const { FALLBACK_KINDS, dayKinds, eastern, socialGames } = await import(at("lib/server/socialPublish.ts"));
const { socialDrafts, readDraftsCache, storeDraftsCache } = await import(at("lib/server/social.ts"));
const { ensureSchedule } = await import(at("lib/server/socialSchedule.ts"));
// The standing schedule decides the day's kinds; without it dayKinds answers the defaults (first run built nothing).
await ensureSchedule();
const day = eastern(Date.now()).day;
const kinds = dayKinds(day);
// --kinds set,games: build only those (10-23: the Magic pool scan behind "games" outran the 300 s fetch timeout).
const only = process.argv.includes("--kinds") ? process.argv[process.argv.indexOf("--kinds") + 1].split(",") : null;
const extra = FALLBACK_KINDS.filter((k) => !kinds.includes(k) && (!only || only.includes(k)));
console.log(day, "day kinds", kinds, "building", extra);
const T0 = Date.now();
for (const g of await socialGames()) {
  const stored = await readDraftsCache(g, day);
  if (!stored) { console.log(g, "no stored build today, skipped"); continue; }
  const built = await socialDrafts(g, day, extra);
  console.log(g, `built ${built.length} fallback drafts in ${Math.round((Date.now() - T0) / 1000)} s:`, built.map((d) => `${d.kind}/${d.game}: ${d.title}`).join(" | "));
  const have = new Set(stored.drafts.map((d) => d.id));
  locked = false;
  await storeDraftsCache(g, day, [...stored.drafts, ...built.filter((d) => !have.has(d.id))], stored.at);
  locked = true;
  console.log(g, "stored, kept at", new Date(stored.at).toLocaleString("en-US", { timeZone: "America/New_York" }));
}
process.exit(0);
