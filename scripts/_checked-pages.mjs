// READ ONLY: the live card page of every active eBay sold check (price_checked, off_day NULL), found through the sitemap:
// does it print a price or "This price looks off"? 10-21: Dark Charizard 1st base5-4-1st blank with a $700 check.
// node scripts/_checked-pages.mjs   (one page every 1.5 s)
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const checks = (await c.execute("SELECT game, card_id, variant, usd FROM price_checked WHERE off_day IS NULL ORDER BY usd DESC")).rows;
const index = await (await fetch("https://cardflip.io/sitemap.xml")).text();
const files = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => /sitemap/.test(u) && u !== "https://cardflip.io/sitemap.xml");
const want = new Map(checks.map((k) => [`--${k.card_id}`.toLowerCase(), k]));
const urls = new Map();
for (const f of files) {
  const xml = await (await fetch(f)).text();
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const u = m[1]; const i = u.lastIndexOf("--"); if (i < 0) continue;
    const k = want.get(u.slice(i).toLowerCase()); if (k) urls.set(`${k.game}|${k.card_id}`, u);
  }
}
let blank = 0, priced = 0, nourl = 0;
for (const k of checks) {
  const u = urls.get(`${k.game}|${k.card_id}`);
  if (!u) { nourl++; console.log(`NOURL	${k.game}	${k.card_id}	${k.variant}	check ${k.usd}`); continue; }
  const h = await (await fetch(u)).text();
  const title = (h.match(/<title>([^<]*)<\/title>/) || [])[1] ?? "";
  if (h.includes("This price looks off")) { blank++; console.log(`BLANK\t${k.game}\t${k.card_id}\t${k.variant}\tcheck ${k.usd}\t${u}`); }
  else priced++;
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(`${checks.length} checks: ${priced} pages priced, ${blank} blank, ${nourl} not in the sitemap`);
