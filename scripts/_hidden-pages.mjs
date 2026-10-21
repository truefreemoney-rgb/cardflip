// READ ONLY: what the live card page shows for each "Hidden by eBay" card (data/hidden-todo.json from _hidden-todo.mjs),
// so eBay sold searches go only to pages whose number looks wrong. node scripts/_hidden-pages.mjs [game] [count]
import fs from "node:fs";
import { createClient } from "@libsql/client";
const c = createClient({ url: "file:data/cardflip.db" });
const slugify = (t, max = 60) => (t.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’'`]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "")) || "card";
const game = process.argv[2] ?? "mtg";
const count = Number(process.argv[3] ?? 30);
const list = JSON.parse(fs.readFileSync("data/hidden-todo.json", "utf8")).filter((x) => x.game === game).slice(0, count);
const gameSlug = { mtg: "magic", pokemon: "pokemon", yugioh: "yugioh", lorcana: "lorcana", onepiece: "one-piece" }[game];
for (const x of list) {
  let url;
  if (game === "mtg") {
    const r = (await c.execute({ sql: "SELECT name, set_code, set_name, collector_number FROM mtg_cards WHERE id = ?", args: [x.id] })).rows[0];
    if (!r) { console.log(`?? ${x.id} not in local mirror`); continue; }
    url = `https://cardflip.io/cards/${gameSlug}/${slugify(String(r.set_name))}/${slugify(String(r.name))}--${encodeURIComponent(`${String(r.set_code).toLowerCase()}-${r.collector_number}`)}`;
  } else {
    const r = (await c.execute({ sql: "SELECT name, set_name FROM tcg_cards WHERE id = ?", args: [x.id] })).rows[0];
    if (!r) { console.log(`?? ${x.id} not in local mirror`); continue; }
    url = `https://cardflip.io/cards/${gameSlug}/${slugify(String(r.set_name))}/${slugify(String(r.name))}--${encodeURIComponent(x.id)}`;
  }
  const res = await fetch(`${url}?heat=off`, { headers: { "user-agent": "Mozilla/5.0 CardFlipCheck" }, redirect: "follow" });
  const text = (await res.text()).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const m = text.match(/Market price \$([\d,]+\.\d\d)/);
  const tag = text.match(/Recorded daily by CardFlip\. ([^.]{0,60}?)(?: Price looks wrong| Buy on eBay)/);
  const shown = m ? Number(m[1].replace(/,/g, "")) : null;
  const ratio = shown && x.med ? (shown / x.med).toFixed(1) : "-";
  console.log(`${res.status} ${x.variant.padEnd(8)} tcg $${x.cur} | page ${shown == null ? "NONE" : "$" + shown} | asks med $${x.med} (${ratio}x) n${x.n} | ${tag ? tag[1].trim() : ""} | ${x.label.slice(0, 60)}`);
  await new Promise((r) => setTimeout(r, 700));
}
