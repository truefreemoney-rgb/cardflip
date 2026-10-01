// Yu-Gi-Oh cards TCGplayer has no scan of AND no other printing shows (a brand-new set, 10-01:
// Beyond the Brave) get the card's picture from YGOPRODeck, copied into public/catalog/yugioh
// and served from our own site. YGOPRODeck asks for exactly that: download and re-host, never
// hotlink (https://ygoprodeck.com/api-guide/).
//
//   node scripts/sweep-picture-links.mjs --game yugioh      (first: refreshes the dead list)
//   node scripts/fill-yugioh-own-pictures.mjs [--dry]
//   node scripts/repoint-dead-pictures.mjs --prod           (then: writes the links, local + prod)
//
// Writes scripts/yugioh-own-pictures.json (card name -> our URL), which
// scripts/lib/deadPictureStandIns.mjs reads as the last resort, so the daily sync keeps them.
// A name already in the file is not fetched again. Free: no vision, no paid API.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { deadPictureStandIns } from "./lib/deadPictureStandIns.mjs";

const root = process.cwd();
const dry = process.argv.includes("--dry");
const SITE = "https://cardflip.io";
const DIR = path.join(root, "public", "catalog", "yugioh");
const MAP = path.join(root, "scripts", "yugioh-own-pictures.json");
const HEADERS = { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)" };

const db = new DatabaseSync(path.join(root, "data", "cardflip.db"), { readOnly: true });
const dead = new Set(JSON.parse(fs.readFileSync(path.join(root, "scripts", "dead-pictures-yugioh.json"), "utf8")));
const rows = db.prepare("SELECT id, name, variant, image_url, set_code, set_release_date FROM tcg_cards WHERE game = 'yugioh'").all();
const own = fs.existsSync(MAP) ? JSON.parse(fs.readFileSync(MAP, "utf8")) : {};
// Rows still without a picture once every other printing has been tried (and our own map ignored).
const standIns = deadPictureStandIns(rows, dead);
const open = rows.filter((r) => (dead.has(r.image_url) || r.image_url.startsWith(SITE)) && !standIns.has(r.id));
// Looked at on the 10-01 contact sheet and left out: a "SAMPLE" stamp across the art, and a
// Japanese-text placeholder. Take a name off this list once YGOPRODeck has the English card.
const SKIP = new Set(["Audhumla, Progenitor of the Frozen Expanse", "Clown Crew Cappello"]);
const names = [...new Set(open.map((r) => r.name))].filter((n) => !own[n] && !SKIP.has(n));
console.log(`${open.length} rows with no picture anywhere (${new Set(open.map((r) => r.name)).size} names), ${names.length} names to look up`);

const missing = [];
let added = 0;
if (!dry) fs.mkdirSync(DIR, { recursive: true });
for (const name of names) {
  const res = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?name=${encodeURIComponent(name)}`, { headers: HEADERS }).catch(() => null);
  const card = res?.ok ? (await res.json().catch(() => null))?.data?.[0] : null;
  const image = card?.card_images?.[0]?.image_url;
  await new Promise((r) => setTimeout(r, 120)); // their limit is 20 requests a second
  if (!image) { missing.push(name); continue; }
  if (!dry) {
    const img = await fetch(image, { headers: HEADERS }).catch(() => null);
    if (!img?.ok) { missing.push(name); continue; }
    const file = `${card.id}.jpg`;
    await sharp(Buffer.from(await img.arrayBuffer())).resize({ width: 480, withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toFile(path.join(DIR, file));
    own[name] = `${SITE}/catalog/yugioh/${file}`;
  }
  added++;
}
if (!dry) fs.writeFileSync(MAP, JSON.stringify(Object.fromEntries(Object.entries(own).sort(([a], [b]) => a.localeCompare(b))), null, 1) + "\n");
console.log(`${dry ? "would add" : "added"} ${added}; YGOPRODeck has no picture for ${missing.length}: ${missing.slice(0, 40).join(" | ")}`);
