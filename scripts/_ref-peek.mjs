// LOCAL: show a few Magic rows' printing fields (eBay referee debugging). 10-13.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("data/cardflip.db", { readOnly: true });
for (const [name, num] of [["Cavern of Souls", "410a"], ["Copy Artifact", "53"], ["Gandalf the White", "299"], ["Jayemdae Tome", "258"]]) {
  console.log(db.prepare("SELECT name, set_code, set_name, collector_number, finishes, promo_types, frame_effects, border_color, price_usd, price_usd_foil FROM mtg_cards WHERE name = ? AND collector_number = ?").all(name, num));
}
