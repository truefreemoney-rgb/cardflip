import "server-only";
import { db } from "@/lib/db";
import { POKEMONTCG_IO_SET_MAP } from "@/lib/cardArt";
import { decodePrices, encodePrices, setDay } from "@/lib/priceSeries";
import type { SeriesUpsert } from "@/lib/server/priceBulkWrite";
import { getSetting, setSetting } from "@/lib/server/settings";
import { TCGCSV_UA } from "@/lib/server/tcgcsv";

/**
 * Second sources for the TCGplayer market price (Chris 10-08, tcgcsv.com
 * blocked our agent: "using the backup, make the emails work properly, add
 * any backups you need for every game"). Both carry TCGplayer's own market
 * number, so their points go into the SAME "tcgplayer" USD series the card
 * pages, movers and weekly mails read; nothing downstream knows the difference.
 *
 *   Pokémon   pokemontcg.io  one call per set (205 sets, ≤2 pages each), no key
 *             needed under 1,000 calls a day; ids differ from TCGdex's in 48 sets
 *             (POKEMONTCG_IO_SET_MAP) and drop the zero padding.
 *   Yu-Gi-Oh! YGOPRODeck     one 21 MB call for every card; each printing's
 *             set_price is TCGplayer's, matched on our collector number
 *             ("SUDA-EN049") + rarity. 1st Edition twins get no point (the
 *             feed does not split editions).
 *
 * Lorcana (Lorcast), One Piece (optcgapi) and Magic (Scryfall) never used
 * tcgcsv as their first source; their fallbacks are the existing CardTrader /
 * Cardmarket fills. Nothing here runs unless the first source failed.
 */

const UA = { "User-Agent": TCGCSV_UA };
const MIN_TRACKED_USD = 0.05;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Pokémon: pokemontcg.io                                              */
/* ------------------------------------------------------------------ */

/** TCGdex id → pokemontcg.io id ("sv03-001" → "sv3-1"). */
export function pokemontcgIoId(tcgdexId: string): string {
  const dash = tcgdexId.lastIndexOf("-");
  if (dash < 0) return tcgdexId;
  const setId = tcgdexId.slice(0, dash);
  const localId = tcgdexId.slice(dash + 1);
  const set = POKEMONTCG_IO_SET_MAP[setId] ?? setId;
  const number = /^\d+$/.test(localId) ? String(Number(localId)) : localId;
  return `${set}-${number}`;
}

/** pokemontcg.io price keys → our series variants (1st Edition keys go to the "-1st" twin). */
export function pokemontcgIoVariant(key: string): string {
  if (key === "1stEditionNormal") return "1stEdition";
  if (key === "unlimitedNormal") return "unlimited";
  return key;
}

interface IoPage {
  data?: IoCard[];
  totalCount?: number;
  count?: number;
}

export interface IoCard {
  id: string;
  tcgplayer?: { prices?: Record<string, { market?: number | null } | null> } | null;
}

/** Pure: the series writes for one batch of pokemontcg.io cards. */
export function pokemontcgIoUpserts(
  cards: IoCard[],
  ioToOurs: Map<string, string>,
  twins: Set<string>,
  existing: Map<string, { startDay: string; prices: string }>,
  touched: Set<string>,
  day: string,
): SeriesUpsert[] {
  const out: SeriesUpsert[] = [];
  for (const c of cards) {
    const ours = ioToOurs.get(c.id);
    if (!ours) continue;
    for (const [k, v] of Object.entries(c.tcgplayer?.prices ?? {})) {
      const price = v?.market;
      if (typeof price !== "number" || !(price > 0)) continue;
      const variant = pokemontcgIoVariant(k);
      const stamped = variant.startsWith("1stEdition");
      const cardId = stamped && twins.has(`${ours}-1st`) ? `${ours}-1st` : ours;
      const key = `${cardId}|${variant}`;
      if (touched.has(key)) continue;
      const prev = existing.get(key);
      if (!prev && price < MIN_TRACKED_USD) continue;
      const next = setDay(prev ? { startDay: prev.startDay, prices: decodePrices(prev.prices) } : null, day, price);
      out.push({ cardId, game: "pokemon", variant, source: "tcgplayer", currency: "USD", startDay: next.startDay, prices: encodePrices(next.prices), updatedDay: day });
      touched.add(key);
    }
  }
  return out;
}

export interface PokemonBackupResult {
  sets: number;
  /** Sets finished today (this run and earlier ones). */
  setsDone: number;
  setsFailed: number;
  /** Sets still to fetch when the deadline stopped the run; 0 = today's backup is complete. */
  setsLeft: number;
  upserts: SeriesUpsert[];
}

/** The day tcgcsv failed entirely (set by the refresh); /api/cron/pokemon-backup keeps going while sets are left. */
export const POKEMON_BACKUP_NEEDED_KEY = "pokemontcgio_needed";
const POKEMON_BACKUP_DONE_KEY = "pokemontcgio_done";

async function doneSets(day: string): Promise<Set<string>> {
  try {
    const raw = JSON.parse((await getSetting(POKEMON_BACKUP_DONE_KEY)) ?? "null") as { day: string; sets: string[] } | null;
    return new Set(raw?.day === day ? raw.sets : []);
  } catch {
    return new Set();
  }
}

/**
 * Every Pokémon set from pokemontcg.io, written as today's TCGplayer point. pokemontcg.io is slow (10-08: ~9 min for
 * 205 sets with retries), past one server run, so the work is resumable: sets done today are remembered and a run
 * stops at `deadline`; /api/cron/pokemon-backup picks up the rest. Never throws; a failed set is counted and retried next run.
 */
export async function pokemonBackupFromPokemontcgIo(
  day: string,
  existing: Map<string, { startDay: string; prices: string }>,
  touched: Set<string>,
  deps: { fetch?: typeof fetch; deadline?: number } = {},
): Promise<PokemonBackupResult> {
  const f = deps.fetch ?? fetch;
  const deadline = deps.deadline ?? Number.POSITIVE_INFINITY;
  const done = await doneSets(day);
  const rows = (await db.prepare("SELECT id, set_id FROM en_cards").all()) as { id: string; set_id: string }[];
  const twins = new Set(rows.filter((r) => r.id.endsWith("-1st")).map((r) => r.id));
  const ioToOurs = new Map<string, string>();
  const sets = new Set<string>();
  for (const r of rows) {
    if (r.id.endsWith("-1st")) continue;
    ioToOurs.set(pokemontcgIoId(r.id), r.id);
    sets.add(POKEMONTCG_IO_SET_MAP[r.set_id] ?? r.set_id);
  }
  const upserts: SeriesUpsert[] = [];
  let setsFailed = 0;
  const queue = [...sets].filter((s) => !done.has(s));
  const worker = async () => {
    for (let set = queue.shift(); set; set = queue.shift()) {
      if (Date.now() > deadline) {
        queue.unshift(set);
        return;
      }
      try {
        for (let page = 1; page <= 3; page++) {
          // pokemontcg.io answers 500/502 a lot (10-08: 122 of 205 sets on the first try): retry with a pause.
          let body: IoPage | null = null;
          for (let attempt = 1; attempt <= 4 && !body; attempt++) {
            const res = await f(`https://api.pokemontcg.io/v2/cards?q=set.id:${encodeURIComponent(set)}&select=id,tcgplayer&pageSize=250&page=${page}`, { headers: UA, signal: AbortSignal.timeout(30_000) });
            if (res.ok) body = (await res.json()) as IoPage;
            else if ((res.status === 429 || res.status >= 500) && attempt < 4) await sleep(2000 * attempt);
            else throw new Error(`HTTP ${res.status}`);
          }
          if (!body) throw new Error("no answer after 4 tries");
          upserts.push(...pokemontcgIoUpserts(body.data ?? [], ioToOurs, twins, existing, touched, day));
          if ((body.count ?? 0) < 250 || page * 250 >= (body.totalCount ?? 0)) break;
        }
        done.add(set);
      } catch (err) {
        setsFailed++;
        console.warn(`pokemontcg.io set ${set}:`, err instanceof Error ? err.message : err);
      }
      await sleep(150);
    }
  };
  await Promise.all([1, 2, 3].map(worker));
  await setSetting(POKEMON_BACKUP_DONE_KEY, JSON.stringify({ day, sets: [...done] })).catch(() => {});
  return { sets: sets.size, setsDone: done.size, setsFailed, setsLeft: sets.size - done.size, upserts };
}

/* ------------------------------------------------------------------ */
/* Yu-Gi-Oh!: YGOPRODeck                                               */
/* ------------------------------------------------------------------ */

export interface YgoProCard {
  card_sets?: Array<{ set_code?: string; set_rarity?: string; set_price?: string | number }>;
}

/** Pure: "SUDA-EN049|Quarter Century Secret Rare" → TCGplayer price, from the YGOPRODeck dump. */
export function ygoprodeckPriceMap(cards: YgoProCard[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of cards) {
    for (const s of c.card_sets ?? []) {
      const code = (s.set_code ?? "").trim().toUpperCase();
      const price = Number(s.set_price);
      if (!code || !Number.isFinite(price) || !(price > 0)) continue;
      const key = `${code}|${(s.set_rarity ?? "").trim().toLowerCase()}`;
      // The same printing listed twice: keep the first (the dump lists the main entry first).
      if (!out.has(key)) out.set(key, price);
      // Rarity-free key as a last resort, only when one rarity exists for the code.
      const loose = `${code}|`;
      if (out.has(loose)) {
        if (out.get(loose) !== price) out.set(loose, -1);
      } else out.set(loose, price);
    }
  }
  return out;
}

/** Pure: our Yu-Gi-Oh! rows → TCGplayer points from the YGOPRODeck map. */
export function ygoprodeckPoints(rows: Array<{ id: string; collector_number: string; rarity: string | null }>, prices: Map<string, number>): Array<{ id: string; usd: number | null; foil: null }> {
  const out: Array<{ id: string; usd: number | null; foil: null }> = [];
  for (const r of rows) {
    if (r.id.endsWith("-1st")) continue;
    const code = r.collector_number.trim().toUpperCase();
    const exact = prices.get(`${code}|${(r.rarity ?? "").trim().toLowerCase()}`);
    const loose = prices.get(`${code}|`);
    const usd = exact ?? (loose != null && loose > 0 ? loose : undefined);
    if (usd != null) out.push({ id: r.id, usd, foil: null });
  }
  return out;
}

export async function yugiohBackupFromYgoprodeck(deps: { fetch?: typeof fetch } = {}): Promise<{ points: Array<{ id: string; usd: number | null; foil: null }>; cards: number }> {
  const f = deps.fetch ?? fetch;
  const res = await f("https://db.ygoprodeck.com/api/v7/cardinfo.php", { headers: UA, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`ygoprodeck → HTTP ${res.status}`);
  const dump = (await res.json()) as { data?: YgoProCard[] };
  const prices = ygoprodeckPriceMap(dump.data ?? []);
  const rows: Array<{ id: string; collector_number: string; rarity: string | null }> = [];
  const PAGE = 30_000;
  let after = -1;
  for (;;) {
    const page = (await db
      .prepare(`SELECT rowid AS rid, id, collector_number, rarity FROM tcg_cards WHERE game = 'yugioh' AND rowid > ? ORDER BY rowid LIMIT ${PAGE}`)
      .all(after)) as { rid: number; id: string; collector_number: string; rarity: string | null }[];
    rows.push(...page);
    if (page.length < PAGE) break;
    after = Number(page[page.length - 1].rid);
  }
  return { points: ygoprodeckPoints(rows, prices), cards: dump.data?.length ?? 0 };
}
