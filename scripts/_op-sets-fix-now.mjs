// One-off: run the set repairs on the local mirror now (the nightly sync runs them from here on).
import { DatabaseSync } from "node:sqlite";
import { fixOnePieceSets } from "./lib/onepiece-sets.mjs";
const db = new DatabaseSync("data/cardflip.db");
await fixOnePieceSets(db);
console.log("ghost groups left:", db.prepare("SELECT COUNT(*) AS n FROM (SELECT set_code, set_name FROM tcg_cards WHERE game = 'onepiece' AND id NOT LIKE '%#%' GROUP BY set_code, set_name HAVING COUNT(*) < 5)").get().n);
console.log("blank dates left:", db.prepare("SELECT COUNT(*) AS n FROM tcg_cards WHERE game = 'onepiece' AND set_release_date = '' AND set_code NOT IN ('PROMO','DON')").get().n);
console.log("newest 5:", db.prepare("SELECT set_code, MAX(set_release_date) d FROM tcg_cards WHERE game = 'onepiece' GROUP BY set_code ORDER BY d DESC LIMIT 5").all().map((r) => `${r.set_code} ${r.d}`).join(", "));
