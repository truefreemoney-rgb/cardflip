// Fill missing catalogue art (en_cards.image_url = '') from two sources, and
// list what's still missing so it can be hammered out by hand.
//
//   node scripts/fill-images.mjs [--prod] [--dry]
//
// 1. TCGplayer product images — tcgplayer_products maps card_id → product_id
//    for most modern cards, and TCGplayer's CDN serves a 1000px scan at
//    https://tcgplayer-cdn.tcgplayer.com/product/<id>_in_1000x1000.jpg.
//    Each URL is fetched and checked (200, image/*, > 3 KB) before it's used.
// 2. Hand-supplied art in public/cards/<cardId>.jpg (the McDonald's Charizard
//    and SVP Reuniclus route, 09-03) → https://cardflip.io/cards/<cardId>.jpg.
// 3. pokemontcg.io, for sets the sync's date-join can't pair (their release
//    dates differ from TCGdex's by a day): images.pokemontcg.io/<set>/<n>.png
//    is deterministic, so a hand-kept set map is enough — no API call.
//
// Writes the local mirror (data/cardflip.db) always; --prod also writes
// Turso (.env.migration.json creds), only where image_url is still ''.
// sync-cards never overwrites a non-empty image_url with '', so fills
// survive a resync. Ends by writing docs/missing-images.csv.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

const root = process.cwd();
const prodFlag = process.argv.includes("--prod");
const dry = process.argv.includes("--dry");
const local = createClient({ url: "file:data/cardflip.db" });
let prod = null;
if (prodFlag) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, ".env.migration.json"), "utf8").replace(/^﻿/, ""));
  prod = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
}

const missing = (await local.execute(
  "SELECT id, name, set_name, local_id, set_card_count_official AS total FROM en_cards WHERE image_url = '' ORDER BY set_release_date DESC, local_id",
)).rows;
console.log(`${missing.length} cards without art`);

const products = new Map();
for (const r of (await local.execute("SELECT card_id, product_id FROM tcgplayer_products WHERE game = 'pokemon' OR game IS NULL")).rows) {
  if (!products.has(r.card_id)) products.set(r.card_id, []);
  products.get(r.card_id).push(Number(r.product_id));
}

// TCGdex set_name → pokemontcg.io set id. Verified by hand 09-03 against
// https://api.pokemontcg.io/v2/sets; extend as gaps turn up.
const PTCGIO_SETS = {
  "McDonald's Collection 2016": "mcd16",
  "McDonald's Collection 2017": "mcd17",
  "McDonald's Collection 2018": "mcd18",
  "Brilliant Stars Trainer Gallery": "swsh9tg",
  "Celebrations Classic Collection": "cel25c",
  "SVP Black Star Promos": "svp",
  "SWSH Black Star Promos": "swshp",
  "HGSS Black Star Promos": "hsp",
  "Unseen Forces Unown Collection": "ex10",
  "EX trainer Kit (Latias)": "tk1a",
  "EX trainer Kit (Latios)": "tk1b",
  "Scarlet & Violet Energy": "sve",
};
function ptcgioCandidates(card) {
  const set = PTCGIO_SETS[card.set_name];
  if (!set) return [];
  const raw = String(card.local_id);
  const nums = [...new Set([raw, raw.replace(/^0+(?=\d)/, ""), raw.replace(/^([A-Za-z]+)0+/, "$1")])];
  return nums.flatMap((n) => [`https://images.pokemontcg.io/${set}/${n}_hires.png`, `https://images.pokemontcg.io/${set}/${n}.png`]);
}

async function imageOk(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return false;
    const type = res.headers.get("content-type") ?? "";
    const buf = Buffer.from(await res.arrayBuffer());
    return type.startsWith("image/") && buf.length > 3000;
  } catch {
    return false;
  }
}

async function setImage(id, url) {
  if (dry) return;
  await local.execute({ sql: "UPDATE en_cards SET image_url = ? WHERE id = ? AND image_url = ''", args: [url, id] });
  if (prod) await prod.execute({ sql: "UPDATE en_cards SET image_url = ? WHERE id = ? AND image_url = ''", args: [url, id] });
}

let filled = 0;
const still = [];
for (const card of missing) {
  // 2. hand-supplied first — it was chosen on purpose.
  if (fs.existsSync(path.join(root, "public/cards", `${card.id}.jpg`))) {
    await setImage(card.id, `https://cardflip.io/cards/${card.id}.jpg`);
    console.log(`  hand   ${card.id} ${card.name} (${card.set_name})`);
    filled++;
    continue;
  }
  // 1. TCGplayer
  let done = false;
  for (const pid of products.get(card.id) ?? []) {
    const url = `https://tcgplayer-cdn.tcgplayer.com/product/${pid}_in_1000x1000.jpg`;
    if (await imageOk(url)) {
      await setImage(card.id, url);
      console.log(`  tcgp   ${card.id} ${card.name} (${card.set_name}) ← ${pid}`);
      filled++;
      done = true;
      break;
    }
  }
  // 3. pokemontcg.io by set map
  if (!done) {
    for (const url of ptcgioCandidates(card)) {
      if (await imageOk(url)) {
        await setImage(card.id, url);
        console.log(`  ptcgio ${card.id} ${card.name} (${card.set_name}) ← ${url}`);
        filled++;
        done = true;
        break;
      }
    }
  }
  if (!done) still.push(card);
}

const csv = ["id,name,set,number,total", ...still.map((c) => [c.id, c.name, c.set_name, c.local_id, c.total ?? ""].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
fs.writeFileSync(path.join(root, "docs/missing-images.csv"), csv + "\n");
console.log(`\nfilled ${filled}${dry ? " (dry run)" : ""}; ${still.length} still missing → docs/missing-images.csv`);
