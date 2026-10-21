// READ ONLY: do the 10-16/17 listing-cap cards (data/crash-2026-10-19.json) still say "Down NN%" on their live pages?
// node scripts/_cap-pages.mjs [count]
import fs from "node:fs";
import { createClient } from "@libsql/client";
const c = createClient({ url: "file:data/cardflip.db" });
const slugify = (t, max = 60) => (t.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’'`]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "")) || "card";
const list = JSON.parse(fs.readFileSync("data/crash-2026-10-19.json", "utf8"));
const n = Number(process.argv[2] ?? 15);
const step = Math.max(1, Math.floor(list.length / n));
let down = 0, seen = 0;
for (let i = 0; i < list.length && seen < n; i += step) {
  const x = list[i];
  const r = (await c.execute({ sql: "SELECT name, set_name FROM tcg_cards WHERE id = ?", args: [x.id] })).rows[0] ?? (await c.execute({ sql: "SELECT name, set_name FROM en_cards WHERE id = ?", args: [x.id] }).catch(() => ({ rows: [] }))).rows[0];
  if (!r) { console.log(`?? ${x.id}`); continue; }
  const url = `https://cardflip.io/cards/pokemon/${slugify(String(r.set_name))}/${slugify(String(r.name))}--${encodeURIComponent(x.id)}?heat=off`;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 CardFlipCheck" } });
  const t = (await res.text()).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const d = t.match(/Down \d[\d.]*%/);
  const m = t.match(/Market price \$([\d,]+\.\d\d)/);
  seen++;
  if (d) down++;
  console.log(`${res.status} ${x.id} ${x.v} base $${x.base} capped $${x.now} | page ${m ? "$" + m[1] : "NONE"} ${d ? "| " + d[0] : ""} | ${r.name}`);
  await new Promise((s) => setTimeout(s, 700));
}
console.log(`${down} of ${seen} sampled pages still say "Down"`);
