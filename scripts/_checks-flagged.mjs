// READ ONLY: every active eBay sold check (price_checked, off_day NULL) through the live id lookup (/api/search-card?id=,
// no cache write): is the checked printing's TCGplayer row still flagged ("looks off") on prod? 10-21: Dark Charizard 1st
// base5-4-1st, check $700 = series $700, flagged "spike". node scripts/_checks-flagged.mjs   (one request every 1.5 s)
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const checks = (await c.execute("SELECT game, card_id, variant, usd, n, day FROM price_checked WHERE off_day IS NULL ORDER BY usd DESC")).rows;
let flagged = 0, fine = 0, missing = 0;
for (const k of checks) {
  const url = `https://cardflip.io/api/search-card?id=${encodeURIComponent(k.card_id)}${k.game === "pokemon" ? "" : `&game=${k.game}`}`;
  const j = await (await fetch(url)).json().catch(() => null);
  const p = (j?.cards?.[0]?.prices ?? []).find((x) => x.source === "tcgplayer" && x.currency === "USD" && x.variant === k.variant);
  if (!p) { missing++; console.log(`NO ROW\t${k.game}\t${k.card_id}\t${k.variant}\tcheck ${k.usd}`); }
  else if (p.untrusted) { flagged++; console.log(`FLAGGED\t${k.game}\t${k.card_id}\t${k.variant}\tcheck ${k.usd}\tshown ${p.market}\t${p.untrusted.reason}`); }
  else fine++;
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(`${checks.length} active checks: ${fine} shown, ${flagged} flagged, ${missing} with no TCGplayer row in the answer`);
