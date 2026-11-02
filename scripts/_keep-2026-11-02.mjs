import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const ids = [["yugioh", "ygo-22002-1st"], ["pokemon", "hgss2-95"]];
const write = process.argv[2] === "write";
for (const [g, id] of ids) {
  const r = (await db.execute({ sql: "SELECT variant, price_usd, verdict, reason, day, manual, manual_price, manual_day FROM ebay_asks WHERE game = ? AND card_id = ?", args: [g, id] })).rows;
  console.log(g, id, JSON.stringify(r));
  if (write && r.length === 1 && r[0].verdict === "high" && r[0].manual !== "keep" && id === "ygo-22002-1st") {
    const res = await db.execute({ sql: "UPDATE ebay_asks SET manual = 'keep', manual_price = price_usd, manual_day = ? WHERE game = ? AND card_id = ? AND variant = ?", args: ["2026-11-02", g, id, r[0].variant] });
    console.log("  keep written:", res.rowsAffected);
  }
}
