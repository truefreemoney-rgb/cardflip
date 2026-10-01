// Typed-search check (10-01, after "nami p-117" found nothing): what a seller types into
// Search Cards / the Watchlist box, for every game, through the SAME client code both boxes
// use (lib/cards.ts searchTyped) and the real /api/search-card route.
//
//   npm run dev                      # the route must be up on localhost:3000 (local mirror)
//   npm run search:typed             # every game
//   npm run search:typed -- --game yugioh --per 80 --show 30
//
// For each sampled catalog card it types the shapes people use (name + number, name alone,
// number alone, lowercase, punctuation left out) and checks the card comes back. No vision,
// no spend. A plain sample plus a "tricky" sample (names with punctuation or symbols).
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : null; };
const BASE = opt("base") ?? "http://localhost:3000";
const PER = Number(opt("per") ?? 40);
const SHOW = Number(opt("show") ?? 12);
const only = opt("game");

// searchTyped fetches a relative path; the limiter is per IP, so each call says it is a new one.
const realFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = (url, init = {}) =>
  realFetch(String(url).startsWith("/") ? BASE + url : url, { ...init, headers: { ...(init.headers ?? {}), "x-forwarded-for": `10.9.${(calls >> 8) & 255}.${calls++ & 255}` } });

const { searchTyped } = await import(new URL("../src/lib/cards.ts", import.meta.url).href);
const db = new DatabaseSync(path.join(process.cwd(), "data/cardflip.db"), { readOnly: true });

const fold = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
/** What someone types when they skip the punctuation: letters, digits and spaces only. */
const plain = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[-–—/]/g, " ").replace(/[^A-Za-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const TRICKY = /[^A-Za-z0-9 ]/;

function sample(rows) {
  const k = Math.max(1, Math.floor(rows.length / PER));
  const base = rows.filter((_, i) => i % k === 0).slice(0, PER);
  const tricky = rows.filter((r) => TRICKY.test(r.name) && !base.includes(r));
  const tk = Math.max(1, Math.floor(tricky.length / Math.ceil(PER / 2)));
  return [...base, ...tricky.filter((_, i) => i % tk === 0).slice(0, Math.ceil(PER / 2))];
}

const GAMES = {
  pokemon: {
    rows: () => db.prepare("SELECT id, name, local_id AS number, set_card_count_official AS total, set_name FROM en_cards WHERE id NOT LIKE '%-1st' ORDER BY id").all(),
    shapes: (c) => {
      const frac = /^\d+$/.test(c.number) && c.total ? `${c.number}/${c.total}` : null;
      return [
        frac && ["name number/total", `${c.name} ${frac}`, "id"],
        ["name number", `${c.name} ${c.number}`, "id"],
        ["name only, lowercase", c.name.toLowerCase(), "name"],
        plain(c.name) !== c.name && plain(c.name) && ["no punctuation + number", `${plain(c.name)} ${frac ?? c.number}`, "id"],
        frac && ["number/total only", frac, "id"],
      ];
    },
  },
  mtg: {
    rows: () => db.prepare("SELECT id, name, collector_number AS number, set_code FROM mtg_cards WHERE lang = 'en' ORDER BY id").all(),
    shapes: (c) => [
      ["name SET number", `${c.name} ${c.set_code.toUpperCase()} ${c.number}`, "id"],
      ["lowercase name set number", `${c.name} ${c.set_code} ${c.number}`.toLowerCase(), "id"],
      ["name only, lowercase", c.name.toLowerCase(), "name"],
      plain(c.name) !== c.name && plain(c.name) && ["no punctuation + SET number", `${plain(c.name)} ${c.set_code.toUpperCase()} ${c.number}`, "id"],
      ["SET number only", `${c.set_code.toUpperCase()} ${c.number}`, "id"],
      ["set number only, lowercase", `${c.set_code} ${c.number}`.toLowerCase(), "id"],
      plain(c.name) !== c.name && plain(c.name) && ["no punctuation, name only", plain(c.name), "name"],
    ],
  },
  lorcana: {
    rows: () => db.prepare("SELECT id, name, subtitle, collector_number AS number, set_total AS total FROM tcg_cards WHERE game = 'lorcana' ORDER BY id").all(),
    shapes: (c) => {
      const frac = c.total ? `${c.number}/${c.total}` : null;
      return [
        frac && ["name number/total", `${c.name} ${frac}`, "id"],
        c.subtitle && ["name - version", `${c.name} - ${c.subtitle}`, "id"],
        c.subtitle && ["name version, lowercase", `${c.name} ${c.subtitle}`.toLowerCase(), "id"],
        ["name only, lowercase", c.name.toLowerCase(), "name"],
        plain(c.name) !== c.name && plain(c.name) && ["no punctuation", plain(c.name), "name"],
        frac && ["number/total only", frac, "id"],
      ];
    },
  },
  onepiece: {
    rows: () => db.prepare("SELECT id, name, collector_number AS number FROM tcg_cards WHERE game = 'onepiece' AND collector_number <> '' ORDER BY id").all(),
    shapes: (c) => [
      ["name number", `${c.name} ${c.number}`, "number"],
      ["lowercase name number", `${c.name} ${c.number}`.toLowerCase(), "number"],
      ["number only", c.number, "number"],
      ["name only, lowercase", c.name.toLowerCase(), "name"],
      plain(c.name) !== c.name && plain(c.name) && ["no punctuation + number", `${plain(c.name)} ${c.number}`, "number"],
      ["number without the dash", c.number.replace(/-/g, ""), "number"],
      plain(c.name) !== c.name && plain(c.name) && ["no punctuation, name only", plain(c.name), "name"],
    ],
  },
  yugioh: {
    rows: () => db.prepare("SELECT id, name, collector_number AS number FROM tcg_cards WHERE game = 'yugioh' AND collector_number <> '' ORDER BY id").all(),
    shapes: (c) => [
      ["name number", `${c.name} ${c.number}`, "number"],
      ["lowercase name number", `${c.name} ${c.number}`.toLowerCase(), "number"],
      ["number only", c.number, "number"],
      ["name only, lowercase", c.name.toLowerCase(), "name"],
      plain(c.name) !== c.name && plain(c.name) && ["no punctuation + number", `${plain(c.name)} ${c.number}`, "number"],
      plain(c.name) !== c.name && plain(c.name) && ["no punctuation, name only", plain(c.name), "name"],
      ["number without the dash", c.number.replace(/-/g, ""), "number"],
    ],
  },
};

/** id = that exact row; number = that card number (any printing); name = a card of that name. */
function found(cards, c, truth) {
  if (cards.some((r) => r.id === c.id || r.id === `${c.id}-1st`)) return true;
  if (truth === "id") return false;
  const sameName = (r) => fold(String(r.name).split(" - ")[0]) === fold(c.name) || fold(r.name) === fold(c.name);
  if (truth === "number") return cards.some((r) => String(r.number).toUpperCase() === String(c.number).toUpperCase() && sameName(r));
  return cards.some(sameName);
}

let failures = 0;
for (const [game, def] of Object.entries(GAMES)) {
  if (only && only !== game) continue;
  const cards = sample(def.rows());
  const tally = new Map();
  const jobs = cards.flatMap((c) => def.shapes(c).filter(Boolean).map(([shape, query, truth]) => ({ c, shape, query, truth })));
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      const t = tally.get(j.shape) ?? { ok: 0, n: 0, misses: [] };
      tally.set(j.shape, t);
      t.n++;
      try {
        const got = (await searchTyped(j.query, game, "en")) ?? null;
        if (got && found(got, j.c, j.truth)) t.ok++;
        else t.misses.push(`"${j.query}"  want ${j.c.name} ${j.c.number} (${j.c.id})  got ${got === null ? "nothing searchable" : got.length === 0 ? "no cards" : `${got.length}: ${got[0].name} ${got[0].number}`}`);
      } catch (err) {
        t.misses.push(`"${j.query}"  ERROR ${err?.message ?? err}`);
      }
      if (process.stdout.isTTY) process.stdout.write(`\r${game} ${next}/${jobs.length}   `);
    }
  }));
  if (process.stdout.isTTY) process.stdout.write("\r");
  console.log(`\n== ${game}: ${cards.length} cards, ${jobs.length} typed searches`);
  for (const [shape, t] of tally) {
    console.log(`  ${t.ok === t.n ? "PASS" : "MISS"}  ${shape.padEnd(30)} ${t.ok}/${t.n}`);
    failures += t.n - t.ok;
    for (const m of t.misses.slice(0, SHOW)) console.log(`        ${m}`);
    if (t.misses.length > SHOW) console.log(`        (+${t.misses.length - SHOW} more)`);
  }
}
console.log(`\n${failures === 0 ? "All typed searches found their card" : `${failures} typed searches missed`}`);
process.exit(failures === 0 ? 0 : 1);
