// deadPictureStandIns: which picture a row with a dead link borrows. Pure, no DB.
//   node scripts/test-dead-picture-standins.mjs
import { deadPictureStandIns } from "./lib/deadPictureStandIns.mjs";

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

const DEAD = "https://cdn/dead-";
const OWN = "https://cardflip.io/catalog/yugioh/1.jpg";
const row = (id, name, variant, image_url) => ({ id, name, variant, image_url, set_release_date: "2026-09-01" });
const own = { "New Card": OWN };

// First run: nothing shows the card anywhere.
const first = [row("a", "New Card", "", DEAD + "a"), row("b", "New Card", "extended-art", DEAD + "b"), row("c", "New Card", "alt-art", DEAD + "c")];
const dead = new Set(first.map((r) => r.image_url));
let out = deadPictureStandIns(first, dead, own);
check("standard row takes the picture we host", out.get("a"), OWN);
check("extended-art and alt-art rows stay blank", [out.has("b"), out.has("c")], [false, false]);

// Second run (10-01): the standard row now shows the hosted picture, so it is "live".
const second = [row("a", "New Card", "", OWN), first[1], first[2]];
out = deadPictureStandIns(second, dead, own);
check("second run: extended-art and alt-art rows still stay blank", [out.has("b"), out.has("c")], [false, false]);

// A real scan of another printing is still a stand-in for an extended-art row (same art, other treatment).
const scan = [row("a", "Old Card", "", "https://cdn/live.jpg"), row("b", "Old Card", "extended-art", DEAD + "b"), row("c", "Old Card", "alt-art", DEAD + "c")];
out = deadPictureStandIns(scan, dead, own);
check("extended-art borrows a real scan, alt-art does not", [out.get("b"), out.has("c")], ["https://cdn/live.jpg", false]);

console.log(failed ? `\n${failed} failed` : "\nAll stand-in checks passed.");
process.exit(failed ? 1 : 0);
