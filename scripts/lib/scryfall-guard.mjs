/**
 * Every Scryfall request from a script on this PC goes through here (10-05).
 *
 * Why: on 10-03 a picture-link sweep sent ~40k fast requests to
 * cards.scryfall.io and Scryfall blocked this PC's IP until 10-05 (Magic art
 * blank on Chris's home network, Magic videos unrenderable here). Scryfall
 * asks for at most 10 requests/second and an identifying User-Agent, and
 * bans IPs that keep going after a 429.
 *
 * The guard: ~6 requests/second across the whole process, our User-Agent
 * always, a daily cap per host on this PC (data/scryfall-budget.json), and a
 * hard stop when Scryfall pushes back (a second 429, or 3 dropped
 * connections in a row) instead of the old retry-harder loops.
 */
import fs from "node:fs";
import path from "node:path";

const UA = "CardFlip/1.0 (+https://cardflip.io; support@cardflip.io)";
const MIN_GAP_MS = 160;
/** Requests per UTC day from this PC. A full sync-mtg is ~600 API pages. */
const DAILY_CAP = { api: 5000, images: 3000 };
const BUDGET_FILE = path.join(process.cwd(), "data", "scryfall-budget.json");

let last = 0;
let queue = Promise.resolve();
let rateLimited = 0;
let dropped = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function kindOf(url) {
  return /^https:\/\/(cards|c1|svgs)\.scryfall\.io\//.test(url) ? "images" : "api";
}

function spend(kind) {
  const day = new Date().toISOString().slice(0, 10);
  let b = { day, api: 0, images: 0 };
  try {
    const read = JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8"));
    if (read.day === day) b = { ...b, ...read };
  } catch {
    // First request today, or no data dir yet.
  }
  if (b[kind] >= DAILY_CAP[kind]) {
    stop(`daily Scryfall ${kind} cap reached (${DAILY_CAP[kind]} from this PC on ${day}). Sample with --limit, or wait until tomorrow (UTC).`);
  }
  b[kind]++;
  try {
    fs.mkdirSync(path.dirname(BUDGET_FILE), { recursive: true });
    fs.writeFileSync(BUDGET_FILE, JSON.stringify(b));
  } catch {
    // Counting is best-effort; the pace and the stop still hold.
  }
}

function stop(why) {
  console.error(`\nSCRYFALL GUARD: ${why}\nStopping so this PC doesn't get blocked again (10-03).`);
  process.exit(3);
}

/** fetch() for any *.scryfall.com / *.scryfall.io URL. Same signature; headers are merged with ours. */
export function scryfallFetch(url, init = {}) {
  const turn = queue.then(async () => {
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
  });
  queue = turn;
  return turn.then(async () => {
    spend(kindOf(url));
    let res;
    try {
      res = await fetch(url, { ...init, headers: { Accept: "application/json, image/*;q=0.8", ...init.headers, "User-Agent": UA } });
    } catch (err) {
      if (++dropped >= 3) stop(`3 dropped connections in a row (${err?.cause?.code ?? err?.message ?? err}). That is what the 10-03 IP block looked like.`);
      throw err;
    }
    dropped = 0;
    if (res.status === 429) {
      if (++rateLimited >= 2) stop("Scryfall answered 429 Too Many Requests twice.");
      const after = Number(res.headers.get("retry-after")) || 10;
      console.warn(`  Scryfall 429: pausing ${after}s, the next one stops the run`);
      await sleep(after * 1000);
      last = Date.now();
    }
    return res;
  });
}

/** For scripts that fetch links from many hosts: Scryfall ones go through the guard, the rest straight. */
export function guardedFetch(url, init) {
  return /^https:\/\/[a-z0-9.-]*scryfall\.(io|com)\//i.test(String(url)) ? scryfallFetch(String(url), init) : fetch(url, init);
}
