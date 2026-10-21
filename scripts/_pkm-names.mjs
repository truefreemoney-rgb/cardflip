// READ ONLY (local mirror): names/sets/rarity for Pokemon card ids.
import { createClient } from "@libsql/client";
const c = createClient({ url: "file:data/cardflip.db" });
const cols = (await c.execute("PRAGMA table_info(en_cards)")).rows.map((r) => String(r.name));
const want = cols.filter((k) => /^(id|name|set_name|number|local_id|rarity|set_id|variants)$/.test(k));
for (const id of process.argv.slice(2)) {
  const r = (await c.execute({ sql: `SELECT ${want.join(",")} FROM en_cards WHERE id = ?`, args: [id] })).rows[0];
  console.log(id, r ? want.map((k) => `${k}=${r[k]}`).join(" | ") : "not found");
}
