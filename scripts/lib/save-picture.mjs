/**
 * Save a card picture to OUR storage (Vercel Blob), 10-12.
 *
 * Chris 10-12: "find card, save to our database and everything pulls from
 * there." Every outside picture host has bitten us (optcgapi courtesy rule,
 * TCGplayer 403s, Scryfall IP block, YGOPRODeck asks for re-hosting), so each
 * card's picture is fetched once, made into two webp copies and kept in the
 * store the site already uses (board/, social/, tickets/):
 *
 *   cards/<game>/<id>-<src8>.webp        ~500px wide, the card's own page
 *   cards/<game>/<id>-<src8>-tile.webp   240px wide, list tiles
 *
 * <src8> is a hash of the source URL: a changed source picture gets a new
 * path (the Blob CDN caches a path for up to a month, so overwriting in
 * place can serve stale bytes) and the old pair is deleted.
 *
 * Politeness, per Chris ("each game may have its own limit"): every source
 * host gets its own gap between requests and its own daily cap
 * (data/picture-budget.json, UTC day, this PC), our User-Agent always, and
 * the run STOPS on the first 429. Blob's own limits (Pro: 75 uploads/s) are
 * far above what the source pacing allows.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const UA = "CardFlip/1.0 (+https://cardflip.io; support@cardflip.io)";
const BUDGET_FILE = path.join(process.cwd(), "data", "picture-budget.json");

/** Per source host: gap between requests (ms) and pictures per UTC day from this PC. */
const SOURCE_LIMITS = {
  // Lorcast publishes no limit (checked 10-12; api.lorcast.com answers without
  // rate headers, the CDN is Cloudflare with a 4h cache). sync-lorcana.mjs has
  // used 150 ms between API calls since 09-21 without a 429; pictures go slower.
  "cards.lorcast.io": { gapMs: 250, daily: 5000 },
  // optcgapi publishes no number (checked 10-12): one person's Hostinger site,
  // /about/general says the API "will have some limits on how much data can be
  // pulled each day". ~170 KB per picture, so 1/s and half its catalog a day.
  "optcgapi.com": { gapMs: 1000, daily: 2500 },
  // TCGplayer's CDN publishes no limit either; a 403 there means "no scan of
  // that product", not a block (memory: catalog picture gaps).
  "tcgplayer-cdn.tcgplayer.com": { gapMs: 300, daily: 5000 },
  // TCGdex publishes no limit (checked 10-12): nginx, immutable year-long cache
  // headers, no rate headers. Pokémon's main source, 20k pictures.
  "assets.tcgdex.net": { gapMs: 150, daily: 25000 },
  // pokemontcg.io fails ~half its API calls (enCards.ts); its image host gets the cautious default plus a gap.
  "images.pokemontcg.io": { gapMs: 500, daily: 2000 },
};
const DEFAULT_LIMIT = { gapMs: 500, daily: 2000 };

export const PAGE_WIDTH = 500;
export const TILE_WIDTH = 240;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastByHost = new Map();
// One pacing line per host, so a slow host (optcgapi 1/s) never holds up a fast one.
const queueByHost = new Map();

function limitFor(host) {
  return SOURCE_LIMITS[host] ?? DEFAULT_LIMIT;
}

function spend(host) {
  const day = new Date().toISOString().slice(0, 10);
  let b = { day };
  try {
    const read = JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8"));
    if (read.day === day) b = read;
  } catch {
    // First picture today, or no data dir yet.
  }
  const used = b[host] ?? 0;
  if (used >= limitFor(host).daily) {
    throw new StopRun(`daily cap for ${host} reached (${limitFor(host).daily} pictures from this PC on ${day}). Wait until tomorrow (UTC) or raise SOURCE_LIMITS after checking the source's terms.`);
  }
  b[host] = used + 1;
  try {
    fs.mkdirSync(path.dirname(BUDGET_FILE), { recursive: true });
    fs.writeFileSync(BUDGET_FILE, JSON.stringify(b));
  } catch {
    // Counting is best-effort; the pace and the 429 stop still hold.
  }
}

/** Thrown when the run must end now (429, daily cap). Callers exit(3) on it. */
export class StopRun extends Error {}

/** A politely paced GET of a source picture: one request at a time per host, gap enforced, daily cap counted. */
export async function fetchSourcePicture(url) {
  const host = new URL(url).hostname.toLowerCase();
  const { gapMs } = limitFor(host);
  const turn = (queueByHost.get(host) ?? Promise.resolve()).then(async () => {
    const wait = (lastByHost.get(host) ?? 0) + gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastByHost.set(host, Date.now());
  });
  queueByHost.set(host, turn.catch(() => {}));
  await turn;
  spend(host);
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "image/*" }, signal: AbortSignal.timeout(30_000) });
  if (res.status === 429) throw new StopRun(`${host} answered 429 Too Many Requests. Stopping so this PC is not blocked (10-03 Scryfall lesson).`);
  if (!res.ok) throw new Error(`${url} â†’ ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error(`${url} â†’ ${buf.length} bytes, not a picture`);
  return buf;
}

/** The two webp copies of a source picture. */
export async function makeCopies(buf) {
  const page = await sharp(buf).resize({ width: PAGE_WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  const tile = await sharp(buf).resize({ width: TILE_WIDTH, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
  return { page, tile };
}

export function blobPaths(game, id, src) {
  const src8 = crypto.createHash("sha1").update(src).digest("hex").slice(0, 8);
  const safeId = id.replace(/[^A-Za-z0-9_.-]+/g, "_");
  const base = `cards/${game}/${safeId}-${src8}`;
  return { page: `${base}.webp`, tile: `${base}-tile.webp` };
}

let blob = null;
async function blobClient() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN missing: run with node --env-file=.env.local");
  return (blob ??= await import("@vercel/blob"));
}

/**
 * Fetch, resize and store one card's picture. Returns our two URLs plus
 * sizes. `dry` does everything except the upload (URLs come back empty).
 */
export async function savePicture({ game, id, src, fetchUrl = src, dry = false }) {
  // fetchUrl: a sharper copy of the same picture (Pokémon: TCGdex high.webp for a stored low.webp); src names the paths.
  const buf = await fetchSourcePicture(fetchUrl);
  const { page, tile } = await makeCopies(buf);
  const paths = blobPaths(game, id, src);
  if (dry) return { url: "", tile: "", bytes: { source: buf.length, page: page.length, tile: tile.length }, page, tileBuf: tile };
  const { put } = await blobClient();
  const opts = { access: "public", contentType: "image/webp", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 31536000 };
  const [p, t] = await Promise.all([put(paths.page, page, opts), put(paths.tile, tile, opts)]);
  return { url: p.url, tile: t.url, bytes: { source: buf.length, page: page.length, tile: tile.length } };
}

/** Delete a superseded pair (best effort). */
export async function deletePictures(urls) {
  const { del } = await blobClient();
  const list = urls.filter(Boolean);
  if (list.length) await del(list).catch((err) => console.warn(`  blob delete failed: ${err?.message ?? err}`));
}

/** A contact sheet PNG of tile copies (for Chris to eyeball before a real run). */
export async function contactSheet(tiles, outFile, cols = 6) {
  const w = TILE_WIDTH;
  const h = Math.round(w * 1.4);
  const rows = Math.ceil(tiles.length / cols);
  const composites = [];
  for (let i = 0; i < tiles.length; i++) {
    const img = await sharp(tiles[i].buf).resize({ width: w, height: h, fit: "contain", background: "#111" }).png().toBuffer();
    composites.push({ input: img, left: (i % cols) * (w + 8) + 8, top: Math.floor(i / cols) * (h + 28) + 8 });
    const label = Buffer.from(`<svg width="${w}" height="20"><text x="2" y="14" fill="#ddd" font-size="11" font-family="Arial">${tiles[i].label.replace(/[&<>]/g, "")}</text></svg>`);
    composites.push({ input: label, left: (i % cols) * (w + 8) + 8, top: Math.floor(i / cols) * (h + 28) + 8 + h + 2 });
  }
  await sharp({ create: { width: cols * (w + 8) + 8, height: rows * (h + 28) + 8, channels: 3, background: "#222" } })
    .composite(composites)
    .png()
    .toFile(outFile);
}
