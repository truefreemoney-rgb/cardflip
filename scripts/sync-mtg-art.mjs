#!/usr/bin/env node
// Art Series cards into the Magic mirror. Scryfall's search hides "extras"
// (tokens, art series, emblems) unless asked, so sync-mtg.mjs never saw
// them and a scanned art card matched whatever real card shared a word
// (Chris, 09-03 MTG stress test: "they have art cards … still valuable").
//
//   node --experimental-strip-types --no-warnings scripts/sync-mtg-art.mjs [--prod] [--no-twins] [--dry] [--sample N]
//   (npm run sync:mtgart)
//
// Same row shape and upsert as sync-mtg.mjs. Writes the local mirror; with
// --prod also upserts straight into Turso (.env.migration.json), so prod
// doesn't wait on the next seed export. sync-mtg.mjs calls this before its
// stale-row sweep so the rows survive it in place (their saved pictures too).
//
// Scryfall prices art cards in EUR only (usd null); prod's nightly refresh
// takes TCGplayer's price (lib/server/mtgTcgplayerFill.ts).
//
// GOLD-STAMPED TWINS (10-29, TASKS C11b; Chris asked twice that a print
// TCGplayer sells separately carries its own price): TCGplayer lists most art
// cards twice, plain and "(Gold-Stamped Signature)", the signed copy at ~3x
// the plain (2,461 products in 39 sets; Avatar's at $75-165). Scryfall carries
// such twins for two sets only (Modern Horizons 2 / Strixhaven "12s"). For
// every plain art card whose TCGplayer group sells a gold-stamped product of
// its name + number, this writes a twin row the way Scryfall's look: number
// "<n>s", promo type "stamped", id "<plain id>-s" (or Scryfall's own row where
// it has one), the same name / set / oracle. Its picture is TCGplayer's scan
// of the gold product (image_url; save-pictures.mjs copies it in); until that
// copy exists the plain card's saved picture stands in (own_image_src
// "standin:<plain id>", the stand-in rule save-pictures already keeps). The
// nightly refresh prices it from the gold product (mtgTcgplayerFill "12s" rule;
// mtgPriceRefresh lists "-s" rows as gaps). The twin never outranks the plain
// card in a scan (number "4s" is not the printed "4"); a seller picks it from
// the card's other printings.
//
//   --no-twins  skip the twin pass
//   --dry       no writes at all: skip Scryfall, read the mirror, report the twins
//   --sample N  print N twins (dearest first, then a spread) with plain vs gold prices
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { createClient } from "@libsql/client";
import { scryfallFetch } from "./lib/scryfall-guard.mjs";
import { isArtSeriesSet, isStampedProduct, matchGroup, matchMtgProducts, pricedProducts, tcgplayerScanUrl } from "../src/lib/mtgTcgplayerMatch.ts";

const API = "https://api.scryfall.com";
const HEADERS = { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)", Accept: "application/json" };
const PAGE_DELAY_MS = 120;
const argv = process.argv.slice(2);
const prodFlag = argv.includes("--prod");
const dry = argv.includes("--dry");
// On by default since Chris's yes on the sample sheet (10-29 1:12pm); --no-twins skips the pass.
const twinsFlag = !argv.includes("--no-twins");
const sampleN = argv.includes("--sample") ? Number(argv[argv.indexOf("--sample") + 1]) || 20 : 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

async function getJson(url, attempt = 1) {
  const res = await scryfallFetch(url, { headers: HEADERS });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 6) throw new Error(`${url} → ${res.status} after ${attempt} tries`);
    await sleep(1000 * attempt);
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

const dataDir = path.join(process.cwd(), "data");
const local = new DatabaseSync(process.env.CARDFLIP_DB_PATH ?? path.join(dataDir, "cardflip.db"), dry ? { readOnly: true } : {});
if (!dry) local.exec("PRAGMA journal_mode = WAL");
let prod = null;
if (prodFlag && !dry) {
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".env.migration.json"), "utf8").replace(/^﻿/, ""));
  prod = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
}

const UPSERT = `
  INSERT INTO mtg_cards (
    id, oracle_id, name, set_code, set_name, collector_number, set_release_date,
    image_url, rarity, type_line, finishes, lang,
    price_usd, price_usd_foil, price_usd_etched, price_eur, price_eur_foil, synced_at, promo_types
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, set_code = excluded.set_code, set_name = excluded.set_name,
    collector_number = excluded.collector_number, set_release_date = excluded.set_release_date,
    image_url = CASE WHEN excluded.image_url = '' THEN mtg_cards.image_url ELSE excluded.image_url END,
    rarity = excluded.rarity, type_line = excluded.type_line, finishes = excluded.finishes,
    lang = excluded.lang, price_usd = excluded.price_usd, price_usd_foil = excluded.price_usd_foil,
    price_usd_etched = excluded.price_usd_etched, price_eur = excluded.price_eur,
    price_eur_foil = excluded.price_eur_foil, synced_at = excluded.synced_at, promo_types = excluded.promo_types`;
// The twin: TCGplayer's price never blanks (COALESCE), its own saved picture is kept once it has one, the plain
// card's picture stands in until then.
const UPSERT_TWIN = `
  INSERT INTO mtg_cards (
    id, oracle_id, name, set_code, set_name, collector_number, set_release_date,
    image_url, rarity, type_line, finishes, lang,
    price_usd, price_usd_foil, price_usd_etched, price_eur, price_eur_foil, synced_at, promo_types,
    own_image_url, own_tile_url, own_image_src
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, set_code = excluded.set_code, set_name = excluded.set_name,
    collector_number = excluded.collector_number, set_release_date = excluded.set_release_date,
    image_url = CASE WHEN excluded.image_url = '' THEN mtg_cards.image_url ELSE excluded.image_url END,
    rarity = excluded.rarity, type_line = excluded.type_line, finishes = excluded.finishes,
    lang = excluded.lang, price_usd = COALESCE(excluded.price_usd, mtg_cards.price_usd),
    synced_at = excluded.synced_at, promo_types = excluded.promo_types,
    own_image_url = CASE WHEN mtg_cards.own_image_url = '' THEN excluded.own_image_url ELSE mtg_cards.own_image_url END,
    own_tile_url = CASE WHEN mtg_cards.own_image_url = '' THEN excluded.own_tile_url ELSE mtg_cards.own_tile_url END,
    own_image_src = CASE WHEN mtg_cards.own_image_url = '' THEN excluded.own_image_src ELSE mtg_cards.own_image_src END`;

function imageOf(card) {
  const uris = card.image_uris ?? card.card_faces?.[0]?.image_uris ?? null;
  return uris?.normal ?? uris?.large ?? uris?.small ?? "";
}
function rowOf(c, now) {
  // Art cards are stored double-faced with the same name on both faces
  // ("Delivery Moogle // Delivery Moogle"); keep the single name — that's
  // what's printed and what vision reads.
  const name = c.name.includes(" // ") && c.name.split(" // ")[0] === c.name.split(" // ")[1] ? c.name.split(" // ")[0] : c.name;
  return [
    c.id, c.oracle_id ?? "", name, c.set, c.set_name ?? c.set.toUpperCase(), c.collector_number, c.released_at ?? "",
    imageOf(c), c.rarity ?? "", c.type_line ?? "Art Series", Array.isArray(c.finishes) ? c.finishes.join(",") : "", c.lang ?? "en",
    num(c.prices?.usd), num(c.prices?.usd_foil), num(c.prices?.usd_etched), num(c.prices?.eur), num(c.prices?.eur_foil), now,
    Array.isArray(c.promo_types) ? c.promo_types.join(",") : "",
  ];
}

const now = Date.now();
const prodBatch = [];
if (!dry) {
  const upsertLocal = local.prepare(UPSERT);
  const query = encodeURIComponent("game:paper lang:en layout:art_series include:extras");
  let url = `${API}/cards/search?q=${query}&unique=prints&order=set&page=1`;
  let total = 0;
  const sets = new Set();
  while (url) {
    const json = await getJson(url);
    const rows = json.data ?? [];
    local.exec("BEGIN");
    for (const c of rows) {
      if (!c.set || !c.collector_number || !c.name) continue;
      const row = rowOf(c, now);
      upsertLocal.run(...row);
      prodBatch.push({ sql: UPSERT, args: row });
      sets.add(c.set);
    }
    local.exec("COMMIT");
    total += rows.length;
    url = json.has_more ? json.next_page : null;
    if (url) await sleep(PAGE_DELAY_MS);
  }
  console.log(`local: ${total} art cards across ${sets.size} sets`);
}

// ---------------------------------------------------------------------------
// Gold-stamped twins.
if (twinsFlag) {
  // tcgcsv house rules as lib/server/tcgcsv.ts keeps them (that module is server-only): their "App/X.Y.Z" agent form,
  // 120 ms between requests, one request at a time.
  const TCG = "https://tcgcsv.com/tcgplayer/1";
  const TCG_HEADERS = { "User-Agent": "CardFlip/1.0.0", Accept: "application/json" };
  const tcg = async (url) => {
    await sleep(120);
    const r = await fetch(url, { headers: TCG_HEADERS });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return (await r.json()).results ?? [];
  };
  const art = local
    .prepare(
      `SELECT id, oracle_id, name, set_code, set_name, collector_number, set_release_date, image_url, rarity, type_line, lang,
              promo_types, own_image_url, own_tile_url
         FROM mtg_cards WHERE lang = 'en' AND set_name LIKE '%Art Series'`,
    )
    .all()
    .filter((r) => isArtSeriesSet(r.set_name));
  // Scryfall's own stamped rows ("12s" in amh2 / astx) and earlier twins of ours: the twin row to write, by set + number.
  const stampedRows = new Map(art.filter((r) => /^\d+s$/.test(r.collector_number)).map((r) => [`${r.set_code}|${r.collector_number}`, r]));
  // Plain cards that can have a twin: a bare number (Marvel's "1c" style numbers have no stamped product name to match).
  const plain = art.filter((r) => /^\d+$/.test(r.collector_number) && !r.id.endsWith("-s"));
  const groups = (await tcg(`${TCG}/groups`)).filter((g) => /^Art Series:/i.test(g.name));
  const bySet = new Map();
  for (const r of plain) bySet.set(r.set_code, [...(bySet.get(r.set_code) ?? []), r]);

  const twins = []; // { plain, twinId, fill, plainUsd, product }
  const skipped = { noGroup: [], unsafe: 0 };
  for (const [code, rows] of bySet) {
    const g = matchGroup(code, rows[0].set_name, groups);
    if (!g) {
      skipped.noGroup.push(`${code} ${rows[0].set_name} (${rows.length})`);
      continue;
    }
    const products = pricedProducts(await tcg(`${TCG}/${g.groupId}/products`), await tcg(`${TCG}/${g.groupId}/prices`));
    const byProduct = new Map(products.map((p) => [p.productId, p]));
    const gap = (r, stamped) => ({ id: stamped ? `${r.id}-s` : r.id, name: r.name, setCode: r.set_code, setName: r.set_name, number: stamped ? `${r.collector_number}s` : r.collector_number, finishes: "nonfoil" });
    const fills = new Map(matchMtgProducts([...rows.map((r) => gap(r, false)), ...rows.map((r) => gap(r, true))], products).map((f) => [f.id, f]));
    for (const r of rows) {
      const f = fills.get(`${r.id}-s`);
      if (!f || f.usd == null) continue;
      const product = f.productId != null ? byProduct.get(f.productId) : null;
      // The matcher keys stamped rows to stamped products; a twin is only ever written from one, never a plain product.
      if (!product || !isStampedProduct(product.name)) {
        skipped.unsafe++;
        continue;
      }
      const own = stampedRows.get(`${r.set_code}|${r.collector_number}s`);
      twins.push({ plain: r, twinId: own ? own.id : `${r.id}-s`, fill: f, plainUsd: fills.get(r.id)?.usd ?? null, product });
    }
  }

  const perSet = new Map();
  for (const t of twins) perSet.set(t.plain.set_code, (perSet.get(t.plain.set_code) ?? 0) + 1);
  const scryfallOwn = twins.filter((t) => !t.twinId.endsWith("-s")).length;
  console.log(
    `twins: ${twins.length} gold-stamped art cards in ${perSet.size} sets, ${scryfallOwn} on Scryfall's own stamped rows` +
      ` (plain rows ${plain.length}; sets without a TCGplayer group: ${skipped.noGroup.length}; unsafe matches skipped: ${skipped.unsafe})`,
  );
  for (const s of skipped.noGroup) console.log(`  no group: ${s}`);

  if (sampleN) {
    const money = (v) => (v == null ? "—" : `$${v.toFixed(2)}`);
    const line = (t) => `${t.plain.name} · ${t.plain.set_name} · #${t.plain.collector_number} → #${t.plain.collector_number}s · plain ${money(t.plainUsd)} → gold ${money(t.fill.usd)}`;
    const sorted = [...twins].sort((a, b) => b.fill.usd - a.fill.usd);
    const top = sorted.slice(0, Math.ceil(sampleN / 2));
    const rest = sorted.slice(top.length);
    const step = Math.max(1, Math.floor(rest.length / Math.max(1, sampleN - top.length)));
    const spread = rest.filter((_, i) => i % step === 0).slice(0, sampleN - top.length);
    console.log(`sample (${top.length} dearest, then ${spread.length} across the range):`);
    for (const t of [...top, ...spread]) console.log(`  ${line(t)}`);
    const priced = twins.filter((t) => t.plainUsd != null);
    const ratios = priced.map((t) => t.fill.usd / t.plainUsd).sort((a, b) => a - b);
    console.log(
      `gold vs plain: median ${ratios.length ? ratios[Math.floor(ratios.length / 2)].toFixed(1) : "?"}x over ${priced.length} pairs; ` +
        `gold at $5+: ${twins.filter((t) => t.fill.usd >= 5).length}, $20+: ${twins.filter((t) => t.fill.usd >= 20).length}, $100+: ${twins.filter((t) => t.fill.usd >= 100).length}`,
    );
  }

  if (!dry) {
    const upsertTwin = local.prepare(UPSERT_TWIN);
    local.exec("BEGIN");
    for (const t of twins) {
      const p = t.plain;
      const standIn = p.own_image_url ? [p.own_image_url, p.own_tile_url, `standin:${p.id}`] : ["", "", ""];
      // Scryfall's word for its own twins is "stamped" (astx 12s); it also tags every plain art card of eight sets
      // (Eldraine, Ixalan, Karlov Manor…) with it, so the number suffix "s" and the id are what tell a twin, never this.
      const promos = [...new Set([...(p.promo_types ?? "").split(",").filter(Boolean), "stamped"])].join(",");
      const row = [
        t.twinId, p.oracle_id, p.name, p.set_code, p.set_name, `${p.collector_number}s`, p.set_release_date,
        tcgplayerScanUrl(t.product.productId), p.rarity, p.type_line, "nonfoil", p.lang,
        t.fill.usd, null, null, null, null, now, promos,
        ...standIn,
      ];
      upsertTwin.run(...row);
      prodBatch.push({ sql: UPSERT_TWIN, args: row });
    }
    local.exec("COMMIT");
    console.log(`twins: ${twins.length} rows written`);
  }
}

if (prod) {
  for (let i = 0; i < prodBatch.length; i += 200) {
    await prod.batch(prodBatch.slice(i, i + 200), "write");
  }
  console.log(`prod: upserted ${prodBatch.length} rows`);
}
