// READ ONLY (prod), 10-21: for catalog cards with no price line updated in the last 7 days (and, Magic, no mirror price),
// when did their lines stop and from which source? Answers "why did Magic + Yu-Gi-Oh! lines stop on 10-13".
// node scripts/_stopped-lines-measure.mjs mtg|yugioh
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^ï»¿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const q = async (sql, args = []) => (await c.execute({ sql, args })).rows;
const game = process.argv[2] ?? "mtg";
const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
const catalog = game === "mtg"
  ? "SELECT id, name || ' | ' || set_code || ' ' || collector_number AS label, set_code AS st, lower(set_code || '-' || collector_number) AS slug, (price_usd IS NOT NULL OR price_usd_foil IS NOT NULL OR price_eur IS NOT NULL OR price_eur_foil IS NOT NULL) AS scry FROM mtg_cards"
  : "SELECT id, name || ' | ' || set_name || ' ' || collector_number AS label, set_name AS st, 0 AS scry FROM tcg_cards WHERE game = 'yugioh'";
const cards = (await q(catalog)).filter((r) => !String(r.id).startsWith("sealed-") && !String(r.id).startsWith("tcgp-sealed-"));
const lines = await q("SELECT card_id, variant, source, updated_day, start_day FROM price_series WHERE game = ?", [game]);
const byCard = new Map();
for (const l of lines) {
  const k = String(l.card_id);
  if (!byCard.has(k)) byCard.set(k, []);
  byCard.get(k).push(l);
}
const fresh = (k) => (byCard.get(k) ?? []).some((l) => String(l.updated_day) >= since);
const none = cards.filter((r) => !fresh(String(r.id)) && Number(r.scry) !== 1);
let never = 0;
const lastDay = {}, lastSrc = {}, neverSets = {}, stoppedSets = {};
for (const r of none) {
  const ls = byCard.get(String(r.id)) ?? [];
  if (!ls.length) { never++; neverSets[r.st] = (neverSets[r.st] ?? 0) + 1; continue; }
  const last = ls.reduce((a, b) => (String(b.updated_day) > String(a.updated_day) ? b : a));
  lastDay[last.updated_day] = (lastDay[last.updated_day] ?? 0) + 1;
  lastSrc[last.source] = (lastSrc[last.source] ?? 0) + 1;
  stoppedSets[r.st] = (stoppedSets[r.st] ?? 0) + 1;
}
const top = (o, n = 12) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join("; ");
console.log(`${game}: ${cards.length} cards; no fresh line${game === "mtg" ? " + no mirror price" : ""}: ${none.length}; never had a line: ${never}; had one that stopped: ${none.length - never}`);
console.log("  never-priced sets:", top(neverSets));
console.log("  stopped: last day:", Object.entries(lastDay).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${v}`).join("; "));
console.log("  stopped: last source:", top(lastSrc));
console.log("  stopped sets:", top(stoppedSets));
// Lines (all cards, not just blank ones) whose last day is 10-12 or 10-13, by source: did a whole source stop that day?
const end = {};
for (const l of lines) if (["2026-10-12", "2026-10-13", "2026-10-14"].includes(String(l.updated_day))) end[`${l.updated_day} ${l.source}`] = (end[`${l.updated_day} ${l.source}`] ?? 0) + 1;
console.log("  all lines ending 10-12..10-14 by source:", top(end));
const live = {};
for (const l of lines) if (String(l.updated_day) >= since) live[l.source] = (live[l.source] ?? 0) + 1;
console.log("  fresh lines by source:", top(live));
// Who sees the blank cards: users' inventory rows, wishlists, and page views in the last 30 days (path ends "--<id>").
const blankIds = new Set(none.map((r) => String(r.id)));
const inv = (await q("SELECT catalog_card_id AS id, user_id FROM cards WHERE game = ? AND catalog_card_id IS NOT NULL", [game])).filter((r) => blankIds.has(String(r.id)));
const wish = (await q("SELECT card_id AS id FROM wishlist_items WHERE game = ? AND card_id IS NOT NULL", [game])).filter((r) => blankIds.has(String(r.id)));
const prefix = (await q("SELECT path FROM page_views WHERE path LIKE '/cards/%' AND path LIKE ? LIMIT 1", [`%${[...blankIds][0]}%`]))[0]?.path;
const month = Date.now() - 30 * 86_400_000;
const slugToId = new Map(none.map((r) => [String(r.slug ?? r.id).toLowerCase(), String(r.id)]));
const views = (await q("SELECT path FROM page_views WHERE at >= ? AND path LIKE '/cards/%--%'", [month])).map((r) => slugToId.get(String(r.path).split("--").pop().toLowerCase())).filter(Boolean);
const label = new Map(none.map((r) => [String(r.id), r.label]));
console.log(`  seen: inventory rows ${inv.length} (users ${new Set(inv.map((r) => r.user_id)).size}); wishlist ${wish.length}; page views 30d ${views.length} on ${new Set(views).size} cards`);
if (inv.length) console.log("  inventory e.g.:", [...new Set(inv.map((r) => label.get(String(r.id))))].slice(0, 8).join(" ; "));
if (views.length) console.log("  viewed e.g.:", [...new Set(views)].slice(0, 8).map((id) => label.get(id)).join(" ; "));
console.log("  sample page path for a blank id:", prefix ?? "(none viewed)");
