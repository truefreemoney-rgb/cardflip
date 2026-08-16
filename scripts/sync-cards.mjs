#!/usr/bin/env node
// Mirrors a TCGdex locale into our own SQLite table.
//
// For "ja" and "zh-tw" this exists because TCGdex's name-search doesn't work
// for those locales (confirmed directly — even an exact name returns []).
// For "en" the reason is different: pokemontcg.io is the only English card
// source and it was measured failing 5 of 10 requests, which broke scanning
// outright. A local mirror makes identification independent of it.
//
// English sets also carry a release date and an image URL, which the CJK
// locales don't — those let us rank printings and show thumbnails without
// any network call at all.
//
// Usage:
//   npm run sync:en   (locale=en,     table=en_cards)
//   npm run sync:jp   (locale=ja,     table=jp_cards)
//   npm run sync:zh   (locale=zh-tw,  table=zh_cards)

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const [, , locale, table] = process.argv;

if (!locale || !table) {
  console.error("Usage: node scripts/sync-cards.mjs <locale> <table>");
  process.exit(1);
}

const API_BASE = `https://api.tcgdex.net/v2/${locale}`;

const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, "cardflip.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS ${table} (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    set_id TEXT NOT NULL,
    set_name TEXT NOT NULL,
    local_id TEXT NOT NULL,
    set_release_date TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    set_card_count_official INTEGER,
    set_card_count_total INTEGER,
    set_code TEXT NOT NULL DEFAULT '',
    synced_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_${table}_name ON ${table}(name);
  CREATE INDEX IF NOT EXISTS idx_${table}_local_id ON ${table}(local_id);
`);

// Tables created before release date and images existed need the new columns;
// SQLite has no "ADD COLUMN IF NOT EXISTS", so probe and ignore the duplicate.
for (const column of [
  "set_release_date TEXT NOT NULL DEFAULT ''",
  "image_url TEXT NOT NULL DEFAULT ''",
  "set_card_count_official INTEGER",
  "set_card_count_total INTEGER",
  "set_code TEXT NOT NULL DEFAULT ''",
]) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
  } catch {
    // Already present.
  }
}

// Must come after the ALTERs, not in the CREATE block above: on an existing
// table the CREATE TABLE is a no-op, so indexing a just-added column there
// fails with "no such column".
db.exec(`
  -- The printed fraction is looked up as a pair: numerator against local_id,
  -- denominator against the set's official count. See src/lib/cardNumber.ts.
  CREATE INDEX IF NOT EXISTS idx_${table}_printed
    ON ${table}(local_id, set_card_count_official);
`);

const upsert = db.prepare(`
  INSERT INTO ${table}
    (id, name, set_id, set_name, local_id, set_release_date, image_url,
     set_card_count_official, set_card_count_total, set_code, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    set_name = excluded.set_name,
    local_id = excluded.local_id,
    set_release_date = excluded.set_release_date,
    -- Never let an empty value overwrite a recovered one: image URLs and set
    -- codes come partly from pokemontcg.io, which fails ~half its requests.
    -- A sync run where it was down must not wipe what an earlier run found.
    image_url = CASE WHEN excluded.image_url != ''
                     THEN excluded.image_url ELSE ${table}.image_url END,
    set_card_count_official = excluded.set_card_count_official,
    set_card_count_total = excluded.set_card_count_total,
    set_code = CASE WHEN excluded.set_code != ''
                    THEN excluded.set_code ELSE ${table}.set_code END,
    synced_at = excluded.synced_at
`);

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastError;
}

/**
 * Set codes ("SVI", "BS") for the fraction's optional third component.
 *
 * TCGdex doesn't publish them — its set ids are internal ("sv01"), and none of
 * its 218 sets carry an abbreviation field. pokemontcg.io does publish them as
 * ptcgoCode, so they're borrowed from there in one request.
 *
 * The join is (printedTotal, releaseDate), the same key the pricing join uses
 * and for the same reason: set *names* disagree across the two providers
 * ("Base Set" vs "Base"), and prefix-matching them once paired Base Set with
 * Base Set 2. A count and a date agree exactly or not at all. Collisions are
 * dropped rather than guessed, and the whole thing is best-effort — a set code
 * is a bonus signal, so failing to get one must never fail a sync.
 */
async function fetchSetCodes() {
  const codes = new Map();
  // (official count | release date) -> pokemontcg.io set id, for image
  // recovery. Separate from `codes` because a set without a ptcgoCode can
  // still have images (galleries, promos, McDonald's collections).
  const ids = new Map();
  try {
    // More attempts than the default: this is one cheap call whose failure
    // costs set codes for the entire catalogue, and pokemontcg.io was measured
    // failing 5 of 10 requests (it 502'd on the first run of this sync).
    const res = await fetchJson("https://api.pokemontcg.io/v2/sets?pageSize=250", 5);
    const codeCollisions = new Set();
    for (const set of res.data ?? []) {
      if (!set.printedTotal || !set.releaseDate) continue;
      const key = `${set.printedTotal}|${set.releaseDate.replace(/\//g, "-")}`;
      // Colliding keys keep *all* their sets (Celebrations and its Classic
      // Collection share a count and a date) — image recovery tries each and
      // matches per card, so ambiguity costs a request, not the images.
      if (!ids.has(key)) ids.set(key, []);
      ids.get(key).push(set.id);
      if (!set.ptcgoCode) continue;
      if (codes.has(key)) codeCollisions.add(key);
      codes.set(key, set.ptcgoCode);
    }
    for (const key of codeCollisions) codes.delete(key);
    console.log(`Set codes: ${codes.size} unambiguous (from pokemontcg.io).`);
  } catch (err) {
    console.log(`Set codes: unavailable (${err.message}) — continuing without.`);
  }
  return { codes, ids };
}

/**
 * Pairs no automatic join can find because the providers disagree on the
 * release date itself. Each verified by hand before being added. Matched with
 * the strict name check, like any date-only join.
 */
const MANUAL_SET_PAIRS = {
  // TCGdex splits the Unseen Forces Unowns out and dates them 2005-08-22;
  // pokemontcg.io files them inside ex10, dated 2005/08/01.
  exu: "ex10",
};

/** "GG01" -> "gg1", "001" -> "1" — collector numbers zero-pad differently per provider. */
function normalizeNum(value) {
  return String(value)
    .toLowerCase()
    .replace(/^([a-z]*)0+(?=\d)/, "$1");
}

/**
 * Fill in images TCGdex doesn't have from pokemontcg.io, which usually does.
 *
 * Their set ids can't be derived from TCGdex's ("swsh12.5gg" is "swsh12pt5gg"
 * there, "swsh9.5tg" is "swsh9tg"), so sets are joined on official count +
 * release date — the same key the pricing join uses, for the same reason: it
 * agrees exactly across providers or not at all. Cards inside a joined set
 * are matched by collector number, then by name for the sets that renumber
 * (Celebrations Classic prints "CC001" where they file "1_A"). The image URL
 * comes off their card record, not a guess.
 *
 * As a last resort for sets their API doesn't join, a guessed CDN URL
 * (dot-stripped set id + unpadded number) is tried and HEAD-verified — only
 * URLs that actually resolve are stored, or the placeholder problem just
 * moves from "no URL" to "dead URL".
 */
async function recoverImages(candidates, ptcgioIds) {
  console.log(
    `\nRecovering images for ${candidates.length} cards with no TCGdex API image...`,
  );
  const setImage = db.prepare(`UPDATE ${table} SET image_url = ? WHERE id = ?`);
  let recovered = 0;

  // Pass 1 — TCGdex's own asset store. Asset URLs are deterministic
  // ({serie}/{set}/{localId}), and uploads run ahead of the API's card data:
  // the 2025 MEP promos and recent SVP promos all 404 in the API but serve
  // images at the constructed URL. Probed per card, not per set — within one
  // set some numbers have assets and some don't.
  const stillMissing = [];
  const POOL = 16;
  for (let i = 0; i < candidates.length; i += POOL) {
    await Promise.all(
      candidates.slice(i, i + POOL).map(async (card) => {
        const url = `https://assets.tcgdex.net/${locale}/${card.serieId}/${card.setId}/${card.localId}/low.webp`;
        try {
          const res = await fetch(url, {
            method: "HEAD",
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) {
            setImage.run(url, card.id);
            recovered++;
          } else {
            stillMissing.push(card);
          }
        } catch {
          stillMissing.push(card);
        }
      }),
    );
  }
  console.log(`  TCGdex asset store: ${recovered} images`);

  // Pass 2 — pokemontcg.io's API, per set. Joined on official count +
  // release date; every set sharing the key is tried (Celebrations and its
  // Classic Collection collide), plus derived id guesses for sets their set
  // list can't join ("swsh9.5tg" is filed there as "swsh9tg"). Cards match
  // by collector number, then by unique name for sets that renumber.
  const guesses = [];
  const bySet = new Map();
  for (const card of stillMissing) {
    if (!bySet.has(card.setId)) bySet.set(card.setId, []);
    bySet.get(card.setId).push(card);
  }

  for (const [setId, cards] of bySet) {
    const pids = new Set(
      ptcgioIds.get(`${cards[0].official}|${cards[0].releaseDate}`) ?? [],
    );
    pids.add(setId.replace(/\./g, ""));
    pids.add(setId.replace(/\./g, "pt"));
    pids.add(setId.replace(/\.5/g, ""));
    // Cross-set joins beyond the count+date key are MANUAL ONLY. A generic
    // same-release-date join was tried and attached *sibling printings*: POP
    // Series 6 art onto DP trainer-kit cards, main-set art onto promos — same
    // name and day, different physical card. Wrong art on a listing tool is
    // worse than no art. Matches through a manual pair still must agree on
    // the card name.
    const dateOnly = new Set();
    const manual = MANUAL_SET_PAIRS[setId];
    if (manual && !pids.has(manual)) {
      pids.add(manual);
      dateOnly.add(manual);
    }

    let remaining = [...cards];
    for (const pid of pids) {
      if (remaining.length === 0) break;
      let data;
      try {
        const res = await fetchJson(
          `https://api.pokemontcg.io/v2/cards?q=set.id:${pid}&pageSize=250&select=number,name,images`,
          3,
        );
        data = res.data ?? [];
      } catch {
        continue; // Their API flaking must not fail the sync.
      }
      if (data.length === 0) continue;

      const byNumber = new Map();
      const byName = new Map();
      const nameCollisions = new Set();
      for (const c of data) {
        if (!c.images?.small) continue;
        byNumber.set(normalizeNum(c.number), {
          url: c.images.small,
          name: c.name.toLowerCase(),
        });
        const name = c.name.toLowerCase();
        if (byName.has(name)) nameCollisions.add(name);
        byName.set(name, c.images.small);
      }
      for (const name of nameCollisions) byName.delete(name);

      const unmatched = [];
      for (const card of remaining) {
        const numberHit = byNumber.get(normalizeNum(card.localId));
        const url =
          (numberHit &&
          (!dateOnly.has(pid) ||
            numberHit.name === card.name.toLowerCase())
            ? numberHit.url
            : undefined) ?? byName.get(card.name.toLowerCase());
        if (url) {
          setImage.run(url, card.id);
          recovered++;
        } else {
          unmatched.push(card);
        }
      }
      if (unmatched.length < remaining.length) {
        console.log(
          `  ${setId} -> ${pid}: ${remaining.length - unmatched.length}/${cards.length} images`,
        );
      }
      remaining = unmatched;
    }
    guesses.push(...remaining);
  }

  // HEAD-verified guesses for whatever the API couldn't answer.
  for (let i = 0; i < guesses.length; i += POOL) {
    await Promise.all(
      guesses.slice(i, i + POOL).map(async (card) => {
        // Unpad but keep case — the CDN's paths are case-sensitive.
        const num = String(card.localId).replace(/^([A-Za-z]*)0+(?=\d)/, "$1");
        const url = `https://images.pokemontcg.io/${card.setId.replace(/\./g, "")}/${num}.png`;
        try {
          const res = await fetch(url, {
            method: "HEAD",
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) {
            setImage.run(url, card.id);
            recovered++;
          }
        } catch {
          // Unreachable or missing — the card keeps its placeholder.
        }
      }),
    );
  }

  console.log(`Recovered ${recovered} images from pokemontcg.io.`);
}

async function main() {
  console.log(`Fetching ${locale} set list...`);
  const sets = await fetchJson(`${API_BASE}/sets`);
  console.log(`Found ${sets.length} sets. Syncing cards into ${table}...\n`);

  // Only English cards print a code we can match; the CJK locales don't.
  const ptcgio =
    locale === "en" ? await fetchSetCodes() : { codes: new Map(), ids: new Map() };

  const now = Date.now();
  let totalCards = 0;
  let skipped = 0;
  let pocketSkipped = 0;

  // Cards with no TCGdex image whose pokemontcg.io counterpart might have one.
  const fallbackCandidates = [];

  for (let i = 0; i < sets.length; i++) {
    const set = sets[i];
    process.stdout.write(`[${i + 1}/${sets.length}] ${set.id} — ${set.name} ... `);
    try {
      const detail = await fetchJson(`${API_BASE}/sets/${set.id}`);

      // TCG Pocket is a digital-only game — its cards can't be graded, sold
      // on eBay, or held in a hand, and TCGdex doesn't even serve images for
      // them. They have no business in a physical-card catalogue. The DELETE
      // cleans up mirrors that synced before this filter existed.
      if (detail.serie?.id === "tcgp") {
        db.prepare(`DELETE FROM ${table} WHERE set_id = ?`).run(set.id);
        pocketSkipped++;
        console.log("skipped (TCG Pocket — digital only)");
        continue;
      }

      const cards = detail.cards ?? [];
      const releaseDate = detail.releaseDate ?? set.releaseDate ?? "";

      // The denominator a card actually prints. `official` counts the base set
      // and stops there, which is exactly what "25/102" means — `total`
      // includes the secret rares printed *above* that count, so a card whose
      // localId exceeds `official` is one of them. Storing both lets the
      // lookup tell "4/102" from "4/130" and recognise 201/198 as a secret
      // rare. See src/lib/cardNumber.ts.
      const counts = detail.cardCount ?? set.cardCount ?? {};
      const official = Number.isFinite(counts.official) ? counts.official : null;
      const totalPrinted = Number.isFinite(counts.total) ? counts.total : null;
      const setCode =
        ptcgio.codes.get(`${official}|${releaseDate.slice(0, 10)}`) ?? "";

      db.exec("BEGIN");
      try {
        for (const card of cards) {
          // TCGdex serves images as {base}/{quality}.{ext}; the bare URL 404s.
          const image = card.image ? `${card.image}/low.webp` : "";

          // No TCGdex art in the API — remember everything needed to hunt
          // for the card after the sync. English only: no CJK anywhere else.
          if (!image && locale === "en") {
            fallbackCandidates.push({
              id: card.id,
              name: card.name,
              localId: String(card.localId),
              setId: set.id,
              serieId: detail.serie?.id ?? "",
              official,
              releaseDate: releaseDate.slice(0, 10),
            });
          }

          upsert.run(
            card.id,
            card.name,
            set.id,
            set.name,
            card.localId,
            releaseDate,
            image,
            official,
            totalPrinted,
            setCode,
            now,
          );
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }

      totalCards += cards.length;
      console.log(`${cards.length} cards`);
    } catch (err) {
      skipped++;
      console.log(`skipped (${err.message})`);
    }
  }

  // The upsert preserves previously-recovered URLs, so only cards whose
  // stored row is still imageless actually need hunting.
  const stillEmpty = db.prepare(
    `SELECT 1 FROM ${table} WHERE id = ? AND image_url = ''`,
  );
  const needed = fallbackCandidates.filter((c) => stillEmpty.get(c.id));
  if (needed.length > 0) {
    await recoverImages(needed, ptcgio.ids);
  }

  // Cached lookups were answered by the *old* mirror — without this, a card
  // removed or re-imaged above keeps being served for the whole cache TTL.
  try {
    db.exec("DELETE FROM card_cache");
    console.log("Cleared the lookup cache (it reflected the old mirror).");
  } catch {
    // Cache table doesn't exist yet — nothing stale to clear.
  }

  const withImages = db
    .prepare(`SELECT COUNT(*) c FROM ${table} WHERE image_url != ''`)
    .get().c;
  const withTotals = db
    .prepare(`SELECT COUNT(*) c FROM ${table} WHERE set_card_count_official IS NOT NULL`)
    .get().c;
  const withCodes = db
    .prepare(`SELECT COUNT(*) c FROM ${table} WHERE set_code != ''`)
    .get().c;

  console.log(
    `\nDone. ${totalCards} cards across ${sets.length - skipped - pocketSkipped} sets` +
      (skipped ? ` (${skipped} skipped)` : "") +
      (pocketSkipped ? ` (${pocketSkipped} TCG Pocket sets excluded)` : "") +
      `. ${withImages} have images, ${withTotals} have a set total, ` +
      `${withCodes} have a set code.`,
  );
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
