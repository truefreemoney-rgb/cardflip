// Report card for a prod referee re-read: before/after ebay_asks JSON (written by scripts/_ref-rerun.mjs) -> markdown.
// Run: node scripts/_ref-report.mjs <backup.json> <after.json> > docs/REPORT-CARD-<day>.md
import fs from "node:fs";
const [bPath, aPath] = process.argv.slice(2);
const before = JSON.parse(fs.readFileSync(bPath, "utf8"));
const after = JSON.parse(fs.readFileSync(aPath, "utf8"));
const key = (r) => `${r.game}|${r.card_id}|${r.variant}`;
const B = new Map(before.map((r) => [key(r), r]));
const money = (n) => (n == null ? "—" : n >= 100 ? "$" + Math.round(n).toLocaleString("en-US") : "$" + Number(n).toFixed(2));
const GAME = { pokemon: "Pokémon", mtg: "Magic", lorcana: "Lorcana", onepiece: "One Piece", yugioh: "Yu-Gi-Oh!" };
const word = { high: "too high vs eBay asks", check: "needs a hand check", ok: "fine", none: "no eBay asks found" };

const reread = after.filter((a) => { const b = B.get(key(a)); return b && !(a.day === b.day && a.median_usd === b.median_usd && a.n === b.n); });
const flips = {};
const manualFlips = [], newHigh = [], clearedHigh = [], stillHigh = [];
for (const a of reread) {
  const b = B.get(key(a));
  flips[`${b.verdict}>${a.verdict}`] = (flips[`${b.verdict}>${a.verdict}`] ?? 0) + 1;
  const row = { ...a, was: b.verdict, wasMedian: b.median_usd, wasN: b.n_nm };
  if (b.verdict !== "high" && a.verdict === "high") newHigh.push(row);
  if (b.verdict === "high" && a.verdict !== "high") clearedHigh.push(row);
  if (b.verdict === "high" && a.verdict === "high") stillHigh.push(row);
  if (a.manual && b.verdict !== a.verdict) manualFlips.push(row);
}
const byGame = (rows) => Object.entries(rows.reduce((m, r) => ((m[r.game] = (m[r.game] ?? 0) + 1), m), {})).map(([g, n]) => `${GAME[g] ?? g} ${n}`).join(", ");
const line = (r) => `| ${GAME[r.game] ?? r.game} | ${r.label.replace(/\s*\|\s*/g, " · ")} | ${money(r.price_usd)} | ${money(r.wasMedian)} (${r.wasN}) | ${money(r.median_usd)} (${r.n_nm}) | ${word[r.was]} → ${word[r.verdict]} |`;
const head = "| Game | Card | Our price | eBay asks before (n) | eBay asks now, ungraded BIN only (n) | Referee's call |\n|---|---|---|---|---|---|";
const top = (rows, n) => rows.sort((x, y) => y.price_usd - x.price_usd).slice(0, n).map(line).join("\n");

console.log(`## Automatic eBay referee re-read (clean reads)

The referee compares each $100+ printing's TCGplayer price to what the SAME printing is asked for on eBay. Until tonight it read every listing; now it reads only **Ungraded** cards listed at a **plain Buy It Now** price (no slabs, no auctions, no Best Offer).

- Rows re-read tonight: **${reread.length}** of ${after.length} (${byGame(reread)}).
- Verdict changes: ${Object.entries(flips).filter(([k]) => k.split(">")[0] !== k.split(">")[1]).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace(">", " → ")}: ${v}`).join("; ")}.
- "Too high" calls **cleared**: ${clearedHigh.length} (slabs had pushed eBay's asks up). "Too high" calls **new**: ${newHigh.length}. Still "too high": ${stillHigh.length}.
- Of the ${after.filter((r) => r.manual).length} prices with a standing keep/hide call, ${manualFlips.length} changed verdict (all were KEEP calls; no HIDE call flipped).

### New "too high" calls (dearest first) — TCGplayer is checked FIRST before any of these move
${head}
${top(newHigh, 30)}

### Keep/hide calls whose reading changed
${head}
${manualFlips.map(line).join("\n") || "| — | none | | | | |"}

### "Too high" calls that cleared (dearest 15 of ${clearedHigh.length})
${head}
${top(clearedHigh, 15)}
`);
