// Read-only: prod picture checks (scan_usage rows with a tiebreak) by game and outcome.
// "cancelled" = fewer than 2 candidates had a catalog picture, so nothing was compared
// (vision.ts tiebreakByPicture); "kept the order" = the model looked and declined.
//   node scripts/picture-check-tally.mjs            all time
//   node scripts/picture-check-tally.mjs --days 1   last 24 hours
import { createClient } from "@libsql/client";
import fs from "node:fs";
const j = JSON.parse(fs.readFileSync(new URL("../.env.migration.json", import.meta.url), "utf8"));
const db = createClient({ url: j.dbUrl, authToken: j.dbToken });
const at = process.argv.indexOf("--days");
const days = at > -1 ? Number(process.argv[at + 1]) : 0;
const since = days > 0 ? Date.now() - days * 86_400_000 : 0;

const { rows } = await db.execute({ sql: "SELECT read, at FROM scan_usage WHERE read LIKE '%\"tiebreak\"%' AND at >= ?", args: [since] });
const tally = {};
const cancelled = [];
let first = Infinity;
for (const r of rows) {
  let o; try { o = JSON.parse(String(r.read)); } catch { continue; }
  first = Math.min(first, Number(r.at));
  const t = (tally[o.game] ??= { answered: 0, kept: 0, cancelled: 0 });
  if (o.reason === "catalog picture missing") { t.cancelled++; cancelled.push(`${et(r.at)}  ${o.game}  ${(o.tiebreak ?? []).join(", ")}`); }
  else if (o.pick) t.answered++;
  else t.kept++;
}
function et(ms) { return new Date(Number(ms)).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET"; }

console.log(`prod picture checks${days ? `, last ${days} day(s)` : rows.length ? `, since ${et(first)}` : ""}`);
console.log("game        answered  kept the order  cancelled (picture missing)");
for (const [g, t] of Object.entries(tally).sort()) console.log(`${g.padEnd(11)} ${String(t.answered).padStart(8)}  ${String(t.kept).padStart(14)}  ${String(t.cancelled).padStart(9)}`);
if (!rows.length) console.log("(none)");
for (const c of cancelled) console.log(`  cancelled: ${c}`);
