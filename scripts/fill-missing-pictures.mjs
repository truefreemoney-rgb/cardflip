// Pictures for catalog rows that have none, Magic and One Piece (Pokémon has
// its own: fill-images.mjs). Chris 10-01: every card shows a picture.
//
//   node scripts/fill-missing-pictures.mjs [--prod] [--dry] [--game mtg|onepiece]
//
// Magic: Scryfall carries no scan for the signed Art Series printings
//   (amh2 / astx "12s"). The unsigned twin ("12", same set) is the same art
//   without the gold signature, so its picture stands in.
// One Piece: the promo feed (optcgapi allPromos) has ~137 entries with a
//   blank card_image. Its card_name is TCGplayer's product name, so the row
//   pairs with the tcgcsv product of the same name and number, and the
//   TCGplayer CDN picture is used when it answers (200, image/*, > 3 KB).
//   Then Bandai's own card list (en.onepiece-cardgame.com) by card id, only
//   where that id is one printing (a "P-0xx" with a single row here): a
//   regular number's promo printing has different art from its base card.
//   Last, the printings that are known to look like another row of the same
//   number (SAME_PICTURE_AS). Rows carrying the feed's "image not available"
//   drawing (scripts/dead-pictures-onepiece.json, from sweep-picture-links.mjs
//   --game onepiece) are blanked first so they go through the same steps.
//
// Writes the local mirror (data/cardflip.db) always; --prod also writes Turso
// (.env.migration.json), only where the picture is still ''. sync-mtg and
// sync-onepiece never overwrite a picture with '', so fills survive a resync.
// Every write is logged to backups/pictures-filled-<date>.json.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { guardedFetch } from "./lib/scryfall-guard.mjs";

const root = process.cwd();
const prodFlag = process.argv.includes("--prod");
const dry = process.argv.includes("--dry");
const gameArg = process.argv.includes("--game") ? process.argv[process.argv.indexOf("--game") + 1] : null;
const local = createClient({ url: "file:data/cardflip.db" });
let prod = null;
if (prodFlag) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, ".env.migration.json"), "utf8").replace(/^﻿/, ""));
  prod = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
}
const HEADERS = { "User-Agent": "cardflip-fill-images/1.0 (support@cardflip.io)", Accept: "application/json" };
const log = [];

async function imageOk(url) {
  try {
    const res = await guardedFetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return false;
    const type = res.headers.get("content-type") ?? "";
    const buf = Buffer.from(await res.arrayBuffer());
    return type.startsWith("image/") && buf.length > 3000;
  } catch {
    return false;
  }
}

async function write(table, columns, id, url, source) {
  log.push({ table, id, url, source });
  if (dry) return;
  for (const col of columns) {
    const sql = `UPDATE ${table} SET ${col} = ? WHERE id = ? AND COALESCE(${col}, '') = ''`;
    await local.execute({ sql, args: [url, id] });
    if (prod) await prod.execute({ sql, args: [url, id] });
  }
}

async function magic() {
  const missing = (await local.execute("SELECT id, name, set_code, collector_number FROM mtg_cards WHERE COALESCE(image_url, '') = ''")).rows;
  console.log(`Magic: ${missing.length} cards without a picture`);
  const still = [];
  for (const card of missing) {
    const base = String(card.collector_number).replace(/s$/i, "");
    const twin = base === String(card.collector_number) ? null : (await local.execute({
      sql: "SELECT image_url FROM mtg_cards WHERE set_code = ? AND collector_number = ? AND name = ? AND COALESCE(image_url, '') <> '' LIMIT 1",
      args: [card.set_code, base, card.name],
    })).rows[0];
    if (twin) await write("mtg_cards", ["image_url"], card.id, String(twin.image_url), `twin ${card.set_code} ${base}`);
    else still.push(card);
  }
  console.log(`  filled ${missing.length - still.length}, not found ${still.length}`);
  for (const c of still) console.log(`  ?? ${c.set_code} ${c.collector_number} ${c.name}`);
  return still.length;
}

// "Vol.1" in the feed is "Vol. 1" at TCGplayer: letters and digits only.
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Rows outside the promo feed, paired by eye with their TCGplayer product (10-01).
const HAND_PRODUCTS = {
  "OP09-051_p2": 596984, // Buggy (051) (Manga)
  "don-don-card-rob-lucci-gold-premium-booster-the-best-vol-2-prb-02#don": 655121,
  "don-don-card-uta-gold-extra-booster-one-piece-heroines-edition-eb-03#don": 677567,
  "don-don-card-alternate-art-gold-the-time-of-battle-op16#don": 698314,
  // Bandai's card list names this one "Premium Card Collection -Best Selection Vol.3-"; TCGplayer only has the Oda-signature print.
  "P-072_pr1#promo": "https://en.onepiece-cardgame.com/images/cardlist/card/P-072.png",
  // The feed still calls it "Illustration Box Vol.1"; TCGplayer renamed the product "(Illustration Box Vol.2) (Textured)"
  // (shops' old Vol.1 pages now carry that title; found through Google Images 10-01).
  "ST13-016_pr1#promo": 623071,
  // Welcome Pack Vol. 1: no scan at TCGplayer or Bandai; our own copies (fill-onepiece-own-pictures.mjs).
  "OP05-030_pr1#promo": "https://cardflip.io/catalog/onepiece/OP05-030-welcome-pack-vol-1.jpg",
  "OP05-004#promo": "https://cardflip.io/catalog/onepiece/OP05-004-welcome-pack-vol-1.jpg",
  "OP05-070#promo": "https://cardflip.io/catalog/onepiece/OP05-070-welcome-pack-vol-1.jpg",
  "OP05-042#promo": "https://cardflip.io/catalog/onepiece/OP05-042-welcome-pack-vol-1.jpg",
  "OP05-105#promo": "https://cardflip.io/catalog/onepiece/OP05-105-welcome-pack-vol-1.jpg",
  "OP04-087#promo": "https://cardflip.io/catalog/onepiece/OP04-087-welcome-pack-vol-1.jpg",
};

// Printings that look like another row of the same number, checked against
// eBay seller photos (10-01): the CS 2023 Finalist cards are the CS 2023 Event
// Pack cards in foil, the Demo Deck 2023 cards are the base cards. The Welcome
// Pack Vol. 1 cards are NOT their base cards (full art, own background).
const SAME_PICTURE_AS = { "cs-2023-event-pack-finalist-ver": "cs-2023-event-pack", "demo-deck-2023": "" };

async function onePiece() {
  // A link the sweep found to be the "image not available" drawing is no picture.
  const deadFile = path.join(root, "scripts", "dead-pictures-onepiece.json");
  const deadLinks = fs.existsSync(deadFile) ? JSON.parse(fs.readFileSync(deadFile, "utf8")) : [];
  if (!dry) for (const url of deadLinks) for (const col of ["image_url", "ref_image_url"]) {
    const sql = `UPDATE tcg_cards SET ${col} = '' WHERE game = 'onepiece' AND ${col} = ?`;
    await local.execute({ sql, args: [url] });
    if (prod) await prod.execute({ sql, args: [url] });
  }
  const missing =(await local.execute("SELECT id, name, collector_number, variant, set_code FROM tcg_cards WHERE game = 'onepiece' AND COALESCE(image_url, '') = ''")).rows;
  console.log(`One Piece: ${missing.length} cards without a picture`);
  const feedRaw = await (await fetch("https://optcgapi.com/api/allPromos/", { headers: HEADERS, signal: AbortSignal.timeout(60000) })).json();
  const feed = new Map((Array.isArray(feedRaw) ? feedRaw : feedRaw.results ?? feedRaw.data ?? []).map((c) => [`${c.card_image_id ?? c.card_set_id}#promo`, c]));
  const groups = (await (await fetch("https://tcgcsv.com/tcgplayer/68/groups", { headers: HEADERS })).json()).results ?? [];
  const promoGroups = groups.filter((g) => /promotion cards|release event|tournament cards|revision pack|collection sets/i.test(g.name));
  const byName = new Map();
  for (const g of promoGroups) {
    const products = (await (await fetch(`https://tcgcsv.com/tcgplayer/68/${g.groupId}/products`, { headers: HEADERS, signal: AbortSignal.timeout(60000) })).json()).results ?? [];
    for (const p of products) {
      const ed = Object.fromEntries((p.extendedData ?? []).map((e) => [e.name, e.value]));
      const key = norm(p.name);
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push({ id: p.productId, number: String(ed.Number ?? "") });
    }
  }
  const printings = new Map();
  for (const r of (await local.execute("SELECT collector_number, COUNT(*) n FROM tcg_cards WHERE game = 'onepiece' GROUP BY collector_number")).rows) printings.set(String(r.collector_number), Number(r.n));
  const still = [];
  for (const card of missing) {
    let done = false;
    const entry = feed.get(String(card.id));
    if (HAND_PRODUCTS[card.id]) {
      const hand = HAND_PRODUCTS[card.id];
      const url = typeof hand === "number" ? `https://tcgplayer-cdn.tcgplayer.com/product/${hand}_in_1000x1000.jpg` : hand;
      if (await imageOk(url)) {
        await write("tcg_cards", ["image_url", "ref_image_url"], card.id, url, typeof hand === "number" ? `tcgplayer ${hand} (hand map)` : url.startsWith("https://cardflip.io/") ? "own copy (hand map)" : "bandai card list (hand map)");
        done = true;
      }
    }
    if (!done && entry) {
      let hits = byName.get(norm(entry.card_name)) ?? [];
      // TCGplayer split "(Regional … 2025 Vol.1)" into Offline / Online products
      // after the feed scraped it; same card, the Offline scan stands in.
      if (!hits.length) hits = byName.get(norm(String(entry.card_name).replace("(Regional ", "(Offline Regional "))) ?? [];
      if (hits.length > 1) hits = hits.filter((p) => p.number === String(card.collector_number));
      for (const p of hits) {
        const url = `https://tcgplayer-cdn.tcgplayer.com/product/${p.id}_in_1000x1000.jpg`;
        if (await imageOk(url)) {
          await write("tcg_cards", ["image_url", "ref_image_url"], card.id, url, `tcgplayer ${p.id}`);
          done = true;
          break;
        }
      }
    }
    if (!done && /^P-\d+$/.test(String(card.collector_number)) && printings.get(String(card.collector_number)) === 1) {
      const url = `https://en.onepiece-cardgame.com/images/cardlist/card/${card.collector_number}.png`;
      if (await imageOk(url)) {
        await write("tcg_cards", ["image_url", "ref_image_url"], card.id, url, "bandai card list");
        done = true;
      }
    }
    if (!done && String(card.variant) in SAME_PICTURE_AS) {
      const twin = (await local.execute({
        sql: "SELECT id, image_url FROM tcg_cards WHERE game = 'onepiece' AND collector_number = ? AND variant = ? AND COALESCE(image_url, '') <> '' ORDER BY id LIMIT 1",
        args: [card.collector_number, SAME_PICTURE_AS[card.variant]],
      })).rows[0];
      if (twin) {
        // Shown picture only: the scanner's reference stays empty for a stand-in.
        await write("tcg_cards", ["image_url"], card.id, String(twin.image_url), `same picture as ${twin.id}`);
        done = true;
      }
    }
    if (!done) still.push({ ...card, feedName: entry?.card_name ?? "" });
  }
  console.log(`  filled ${missing.length - still.length}, not found ${still.length}`);
  for (const c of still) console.log(`  ?? ${c.id} | ${c.feedName || c.name} | ${c.variant}`);
  return still.length;
}

let notFound = 0;
if (!gameArg || gameArg === "mtg") notFound += await magic();
if (!gameArg || gameArg === "onepiece") notFound += await onePiece();
if (log.length) {
  // A dry run leaves the same list next to it (.dry.json) so the picks can be looked at first.
  const out = path.join(root, "backups", `pictures-filled-${new Date().toISOString().slice(0, 10)}${dry ? ".dry" : ""}.json`);
  const before = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : [];
  fs.writeFileSync(out, JSON.stringify([...before, ...log], null, 1));
}
const bySource = {};
for (const l of log) { const k = l.source.split(" ")[0]; bySource[k] = (bySource[k] ?? 0) + 1; }
console.log(`\n${dry ? "would fill" : "filled"} ${log.length} (${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}); not found ${notFound}${prod ? " | prod written" : ""}`);
