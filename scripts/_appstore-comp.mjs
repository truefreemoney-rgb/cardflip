// LOCAL dev DB only: comp the screenshot account so the eBay listing editor opens (canSell = not trial).
import { createClient } from "@libsql/client";
const db = createClient({ url: "file:data/cardflip.db" });
await db.execute({ sql: "UPDATE users SET access_override = 'comp_standard', tour_seen_at = ? WHERE email = ?", args: [Date.now(), "shots@cardflip.dev"] });
const r = await db.execute({ sql: "SELECT email, access_override, plan, sub_status FROM users WHERE email = ?", args: [Date.now(), "shots@cardflip.dev"] });
console.log(r.rows);
