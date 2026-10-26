// One-off (10-26): 25 SV/ME promos with a "(Pokemon Center Exclusive)" twin on TCGplayer carried the twin's prices in their
// plain holofoil history (May 18-Aug 26 from the TCGCSV backfill; Aug 29-Sep 24 on svp-173 + mep-022 from the daily job), so
// their pages drew a fake 90% crash ("high $308.05 on Jul 21" on a $17 Snorlax). Those days ARE the twin's TCGplayer Near Mint
// market (checked against TCGplayer's own history, e.g. Snorlax PC 05-25 $305.10 / 08-17 $295.42), so this moves them onto the
// pokemonCenterExclusive line and blanks them on the plain line. Dry run by default; --write saves the rows to data/ first.
// Run: node scripts/_fix-pc-history.mjs [--write]
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(new URL("../.env.migration.json", import.meta.url), "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const write = process.argv.includes("--write");
const DAY = 86_400_000;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const dayIndex = (from, d) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

const ids = ["013", "014", "027", "044", "051", "065", "066", "075", "097", "098", "123", "129", "141", "159", "173", "189", "203", "209", "210"].map((n) => `svp-${n}`)
  .concat(["009", "010", "022", "031", "070", "080", "088"].map((n) => `mep-${n}`));
const all = (await db.execute({ sql: `SELECT * FROM price_series WHERE card_id IN (${ids.map(() => "?").join(",")})`, args: ids })).rows.map((r) => ({ ...r }));
const row = (id, variant) => all.find((r) => r.card_id === id && r.variant === variant && r.source === "tcgplayer");

const plan = [];
for (const id of ids) {
  const holo = row(id, "holofoil"), pc = row(id, "pokemonCenterExclusive");
  if (!holo || !pc) { console.log(id, "SKIP: missing", !holo ? "holofoil" : "pokemonCenterExclusive"); continue; }
  const hp = JSON.parse(String(holo.prices));
  const plain = median(hp.filter((v) => v != null).slice(-30));
  const run = hp.map((v, i) => (v != null && v > 3 * plain ? i : -1)).filter((i) => i >= 0);
  if (!run.length) { console.log(id, `clean (plain ~${plain})`); continue; }
  const [a, b] = [run[0], run[run.length - 1]];
  const strays = hp.slice(a, b + 1).filter((v) => v != null && v <= 3 * plain).length;
  const pcp = JSON.parse(String(pc.prices));
  const pcNow = pcp.filter((v) => v != null).pop();
  const ratio = hp[b] / pcNow;
  if (strays || ratio < 0.5 || ratio > 2) { console.log(id, `SKIP: run ${a}..${b} strays ${strays} last/pcNow ${ratio.toFixed(2)}`); continue; }
  // New Pokémon Center line: the moved days, then its own existing points (never overwritten).
  const pcStart = addDays(holo.start_day, a);
  const pcEnd = addDays(pc.start_day, pcp.length - 1);
  const np = new Array(dayIndex(pcStart, pcEnd) + 1).fill(null);
  for (let i = a; i <= b; i++) if (hp[i] != null) np[i - a] = hp[i];
  pcp.forEach((v, i) => { if (v != null) np[dayIndex(pcStart, addDays(pc.start_day, i))] = v; });
  // New plain line: those days blanked, leading blanks trimmed.
  const nh = hp.map((v, i) => (i >= a && i <= b ? null : v));
  const lead = nh.findIndex((v) => v != null);
  const holoStart = addDays(holo.start_day, lead);
  plan.push({ id, holo: { start_day: holoStart, prices: nh.slice(lead) }, pc: { start_day: pcStart, prices: np } });
  console.log(id, `plain ~${plain} | moved ${run.length} days ${addDays(holo.start_day, a)}..${addDays(holo.start_day, b)} (${hp[a]} .. ${hp[b]}) | PC now ${pcNow} | plain line from ${holoStart}, PC line ${pcStart}..${pcEnd}`);
}
console.log(`${plan.length} cards to fix${write ? "" : " (dry run; --write to apply)"}`);
if (write && plan.length) {
  const backup = `data/pc-history-backup-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(new URL(`../${backup}`, import.meta.url), JSON.stringify(all, null, 1));
  console.log("backup:", backup, all.length, "rows");
  await db.batch(plan.flatMap((p) => [
    { sql: "UPDATE price_series SET start_day = ?, prices = ? WHERE card_id = ? AND variant = 'holofoil' AND source = 'tcgplayer'", args: [p.holo.start_day, JSON.stringify(p.holo.prices), p.id] },
    { sql: "UPDATE price_series SET start_day = ?, prices = ? WHERE card_id = ? AND variant = 'pokemonCenterExclusive' AND source = 'tcgplayer'", args: [p.pc.start_day, JSON.stringify(p.pc.prices), p.id] },
  ]), "write");
  console.log("written:", plan.length * 2, "rows");
}
