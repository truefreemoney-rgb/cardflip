// LOCAL database only: drop the eBay referee's table and today's call counter, and clear the schema fingerprint so the
// next start re-creates the table (db.ts initSchema skips the pass when the fingerprint matches). 10-13.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("data/cardflip.db");
db.exec("DROP TABLE IF EXISTS ebay_asks");
console.log(db.prepare("DELETE FROM price_history_meta WHERE key LIKE 'ebay_referee%' OR key = 'schema_fingerprint'").run());
