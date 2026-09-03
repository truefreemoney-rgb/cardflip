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
// 4. TCGplayer via tcgcsv.com (the public mirror the price backfill already
//    uses): a hand-kept TCGdex set → TCGplayer group map, products matched
//    on collector number (name as tiebreak, or alone when the product has
//    no number). Covers McDonald's, trainer kits, My First Battle, promos —
//    Chris, 09-03: "tcgplayer has all these cards on their website".
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

// TCGdex set_name → tcgcsv/TCGplayer groupId(s) (category 3 = Pokémon,
// https://tcgcsv.com/tcgplayer/3/groups). Trainer-kit groups hold both
// half-decks, so numbers repeat and the name settles it.
const TCGCSV_GROUPS = {
  "McDonald's Collection 2016": [3087],
  "McDonald's Collection 2017": [2148],
  "McDonald's Collection 2018": [2364],
  "McDonald's Collection 2023": [23306],
  "McDonald's Collection 2024": [24163],
  "My First Battle": [23330],
  "MEP Black Star Promos": [24451],
  "SVP Black Star Promos": [22872],
  "SWSH Black Star Promos": [2545],
  "HGSS Black Star Promos": [1453],
  "Celebrations Classic Collection": [2931],
  "Yellow A Alternate": [1938],
  "XY trainer Kit (Pikachu Libre)": [1796],
  "XY trainer Kit (Suicune)": [1796],
  "XY trainer Kit (Latias)": [1536],
  "XY trainer Kit (Latios)": [1536],
  "XY trainer Kit (Bisharp)": [1533],
  "XY trainer Kit (Wigglytuff)": [1533],
  "XY trainer Kit (Sylveon)": [1532],
  "XY trainer Kit (Noivern)": [1532],
  "BW trainer Kit (Excadrill)": [1538],
  "BW trainer Kit (Zoroark)": [1538],
  "HS trainer Kit (Gyarados)": [1540],
  "HS trainer Kit (Raichu)": [1540],
  "DP trainer Kit (Manaphy)": [1541],
  "DP trainer Kit (Lucario)": [1541],
  "SM trainer Kit (Lycanroc)": [2069],
  "SM trainer Kit (Alolan Raichu)": [2069],
};
const groupCache = new Map();
async function groupProducts(groupId) {
  if (!groupCache.has(groupId)) {
    try {
      const res = await fetch(`https://tcgcsv.com/tcgplayer/3/${groupId}/products`, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "cardflip-fill-images/1.0 (support@cardflip.io)" } });
      const json = await res.json();
      groupCache.set(groupId, (json.results ?? []).map((p) => {
        const ed = Object.fromEntries((p.extendedData ?? []).map((e) => [e.name, e.value]));
        return { id: p.productId, name: p.name, number: ed.Number ? String(ed.Number) : null };
      }));
    } catch {
      groupCache.set(groupId, []);
    }
  }
  return groupCache.get(groupId);
}
const normNum = (n) => String(n ?? "").split("/")[0].trim().replace(/^([A-Za-z]*)0+(?=\d)/, "$1").toLowerCase();
const normName = (n) => String(n ?? "").replace(/\s*[-–]\s*\d+\s*$/, "").replace(/\s*\([^)]*\)\s*$/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
async function tcgcsvCandidates(card) {
  const groups = TCGCSV_GROUPS[card.set_name];
  if (!groups) return [];
  const products = (await Promise.all(groups.map(groupProducts))).flat();
  const num = normNum(card.local_id);
  const name = normName(card.name);
  let hits = products.filter((p) => p.number && normNum(p.number) === num);
  if (hits.length > 1) hits = hits.filter((p) => normName(p.name) === name);
  if (hits.length === 0) hits = products.filter((p) => !p.number && normName(p.name) === name);
  return hits.map((p) => ({ url: `https://tcgplayer-cdn.tcgplayer.com/product/${p.id}_in_1000x1000.jpg`, id: p.id }));
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
  // 4. TCGplayer via tcgcsv group map
  if (!done) {
    for (const c of await tcgcsvCandidates(card)) {
      if (await imageOk(c.url)) {
        await setImage(card.id, c.url);
        console.log(`  tcgcsv ${card.id} ${card.name} (${card.set_name}) ← ${c.id}`);
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
