import "server-only";
import { db } from "@/lib/db";
import { addDays, decodePrices, todayUtc } from "@/lib/priceSeries";
import { EBAY_REFEREE, refereeable, refereeMatcher, refereeQueries, refereeVerdict, summarizeAsks, type RefereeCard, type RefereeVerdict } from "@/lib/ebayReferee";
import { isEbayConfigured, searchEbayAsks } from "@/lib/server/ebay";
import { withDbRetry } from "@/lib/server/priceBulkWrite";
import { lastPriced } from "@/lib/server/priceTrust";
import { clearTrustMemo } from "@/lib/server/priceTrustSite";
import type { GameId } from "@/lib/types";

/**
 * The nightly eBay referee (10-13; the rule and the matcher are lib/ebayReferee.ts).
 *
 * After the morning price jobs, every $100+ printing of every game is read
 * against what the same printing is asked for on eBay, a few hundred a night
 * in priority order (never read, then price moved 20%+ since its read, then
 * the oldest read), so each one is re-read about weekly. The reading lands in
 * ebay_asks; the price guard (priceTrustSite) re-judges it against whatever
 * price it is about to show.
 *
 * Budget: Browse is ~5,000 calls a day for the whole keyset and the seller
 * comps keep 4,000 of them (api/ebay/comps), so the referee spends at most
 * CALLS_PER_DAY, counted in price_history_meta like every other day budget.
 * A run also stops before the function's time limit; the 8:45am ET cron
 * picks up where the 8:15am one stopped.
 *
 * Pokemon's $100+ printings come from listing_lows (the daily price job keeps
 * TCGplayer's cheapest listing for every $100+ printing it can map): a $100+
 * Pokemon printing with no TCGplayer product is not read yet.
 */

/** Browse calls a day for the referee (comps keep 4,000 of eBay's ~5,000). */
export const CALLS_PER_DAY = 900;
/** A run stops starting new cards after this (the route's maxDuration is 300 s). */
const RUN_MS = 240_000;
/** Cards read in parallel. */
const PARALLEL = 4;
/** The first query's matches below this run the fallback query too. */
const FALLBACK_UNDER = 3;
/** A price this far from the one last read is read again first. */
const MOVED = 0.2;
/** A printing the referee cannot read (prize sets, unknown rare tags) goes straight to the hand-check list from this price up. */
export const HAND_ONLY_MIN = 2000;
const META_KEY = "ebay_referee_last";

export interface RefereeCandidate {
  card: RefereeCard;
  price: number;
  label: string;
}

export interface RefereeRun {
  candidates: number;
  read: number;
  calls: number;
  verdicts: Record<RefereeVerdict, number>;
  failed: number;
  left: number;
  ms: number;
  skipped?: "unconfigured" | "budget";
}

/** Every $100+ printing of every game with its current price (about 4,500 on 10-13). */
export async function refereeCandidates(): Promise<RefereeCandidate[]> {
  const min = EBAY_REFEREE.minUsd;
  const out: RefereeCandidate[] = [];
  const mtg = (await db
    .prepare(
      `SELECT id, name, set_code, set_name, set_release_date, collector_number, finishes, promo_types, flavor_name, border_color, price_usd, price_usd_foil, price_usd_etched
         FROM mtg_cards WHERE MAX(COALESCE(price_usd, 0), COALESCE(price_usd_foil, 0), COALESCE(price_usd_etched, 0)) >= ?`,
    )
    .all(min)) as unknown as {
    id: string; name: string; set_code: string; set_name: string; set_release_date: string; collector_number: string; finishes: string | null; promo_types: string | null;
    flavor_name: string | null; border_color: string | null; price_usd: number | null; price_usd_foil: number | null; price_usd_etched: number | null;
  }[];
  for (const r of mtg) {
    for (const [variant, price] of [["nonfoil", r.price_usd], ["foil", r.price_usd_foil], ["etched", r.price_usd_etched]] as const) {
      if (price == null || price < min) continue;
      out.push({
        price: Number(price),
        label: `${r.name} | ${r.set_name} ${r.collector_number} | ${variant}`,
        card: {
          game: "mtg", cardId: r.id, variant, name: r.name, number: r.collector_number, setName: r.set_name, setCode: r.set_code, releaseDate: r.set_release_date,
          promoTypes: r.promo_types ?? "", finishes: r.finishes ?? "", flavorName: r.flavor_name ?? undefined, borderColor: r.border_color ?? undefined,
        },
      });
    }
  }
  const tcg = (await db
    .prepare(
      `SELECT id, game, name, subtitle, set_name, set_code, set_release_date, collector_number, set_total, rarity, variant, price_usd, price_usd_foil
         FROM tcg_cards WHERE MAX(COALESCE(price_usd, 0), COALESCE(price_usd_foil, 0)) >= ?`,
    )
    .all(min)) as unknown as {
    id: string; game: GameId; name: string; subtitle: string; set_name: string; set_code: string; set_release_date: string; collector_number: string; set_total: number | null;
    rarity: string; variant: string; price_usd: number | null; price_usd_foil: number | null;
  }[];
  for (const r of tcg) {
    for (const [variant, price] of [["normal", r.price_usd], ["foil", r.price_usd_foil]] as const) {
      if (price == null || price < min) continue;
      out.push({
        price: Number(price),
        label: `${r.name}${r.subtitle ? ` - ${r.subtitle}` : ""} | ${r.set_name} ${r.collector_number}${r.variant ? ` ${r.variant}` : ""}${variant === "foil" ? " | foil" : ""}`,
        card: {
          game: r.game, cardId: r.id, variant, name: r.name, subtitle: r.subtitle || undefined, number: r.collector_number, setName: r.set_name,
          setCode: r.set_code, releaseDate: r.set_release_date, setTotal: r.set_total, rarity: r.rarity, printing: r.variant, firstEdition: r.id.endsWith("-1st"),
        },
      });
    }
  }
  out.push(...(await pokemonCandidates(min)));
  return out;
}

async function pokemonCandidates(min: number): Promise<RefereeCandidate[]> {
  const keys = (await db.prepare("SELECT card_id, variant FROM listing_lows WHERE game = 'pokemon'").all()) as unknown as { card_id: string; variant: string }[];
  const want = new Map<string, Set<string>>();
  for (const k of keys) want.set(k.card_id, (want.get(k.card_id) ?? new Set()).add(k.variant));
  const ids = [...want.keys()];
  const out: RefereeCandidate[] = [];
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const marks = chunk.map(() => "?").join(",");
    const bare = [...new Set(chunk.map((id) => id.replace(/-1st$/, "")))];
    const [series, meta] = await Promise.all([
      db.prepare(`SELECT card_id, variant, prices FROM price_series WHERE game = 'pokemon' AND source = 'tcgplayer' AND currency = 'USD' AND card_id IN (${marks})`).all(...chunk) as unknown as Promise<
        { card_id: string; variant: string; prices: string }[]
      >,
      db.prepare(`SELECT id, name, set_name, set_release_date, local_id, set_card_count_official FROM en_cards WHERE id IN (${bare.map(() => "?").join(",")})`).all(...bare) as unknown as Promise<
        { id: string; name: string; set_name: string; set_release_date: string; local_id: string; set_card_count_official: number | null }[]
      >,
    ]);
    const byId = new Map(meta.map((m) => [m.id, m]));
    for (const s of series) {
      if (!want.get(s.card_id)?.has(s.variant)) continue;
      const price = lastPriced(decodePrices(s.prices));
      const m = byId.get(s.card_id.replace(/-1st$/, ""));
      if (price == null || price < min || !m) continue;
      out.push({
        price,
        label: `${m.name} | ${m.set_name} ${m.local_id} | ${s.variant}`,
        card: {
          game: "pokemon", cardId: s.card_id, variant: s.variant, name: m.name, number: m.local_id, setName: m.set_name,
          setTotal: m.set_card_count_official, releaseDate: m.set_release_date, firstEdition: s.card_id.endsWith("-1st"),
        },
      });
    }
  }
  return out;
}

/** Read order: never read, then moved 20%+ since the read, then the oldest read; read today = done. Pure. */
export function refereeOrder(cands: RefereeCandidate[], last: Map<string, { day: string; price: number }>, today: string): RefereeCandidate[] {
  const rank = (c: RefereeCandidate): [number, string] => {
    const l = last.get(askKey(c.card.game, c.card.cardId, c.card.variant));
    if (!l) return [0, ""];
    if (l.day >= today) return [9, l.day];
    if (Math.abs(c.price - l.price) > MOVED * l.price) return [1, l.day];
    return [2, l.day];
  };
  return cands
    .map((c) => ({ c, r: rank(c) }))
    .filter((x) => x.r[0] < 9)
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1].localeCompare(b.r[1]) || b.c.price - a.c.price)
    .map((x) => x.c);
}

export const askKey = (game: string, cardId: string, variant: string) => `${game}|${cardId}|${variant}`;

/** One card: one or two Browse calls, then the reading and its verdict on today's price. */
export async function readOne(c: RefereeCandidate): Promise<{ calls: number; row: AskRow }> {
  const [q1, q2] = refereeQueries(c.card);
  const match = refereeMatcher(c.card);
  const seen = new Map<string, { title: string; price: number }>();
  const add = (list: { title: string; price: number }[]) => {
    for (const l of list) if (match(l.title)) seen.set(`${l.title}|${l.price}`, l);
  };
  add(await searchEbayAsks(q1));
  let calls = 1;
  if (seen.size < FALLBACK_UNDER && q2 !== q1) {
    add(await searchEbayAsks(q2));
    calls++;
  }
  const reading = summarizeAsks(c.card, [...seen.values()]);
  const v = refereeVerdict(c.price, reading);
  return { calls, row: { c, reading, verdict: v.verdict, reason: v.reason, query: q1 } };
}

interface AskRow {
  c: RefereeCandidate;
  reading: ReturnType<typeof summarizeAsks>;
  verdict: RefereeVerdict;
  reason: string;
  query: string;
}

/** Upsert the readings; the manual columns are never touched here (an admin's call outlives the nightly read). */
async function writeRows(rows: AskRow[], day: string): Promise<void> {
  for (let i = 0; i < rows.length; i += 40) {
    const part = rows.slice(i, i + 40);
    const values = part.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",");
    const args = part.flatMap((r) => [
      r.c.card.cardId, r.c.card.game, r.c.card.variant, r.c.price, r.reading.n, r.reading.nNm, r.reading.median, r.reading.q75, r.reading.vintage ? 1 : 0, r.verdict, r.reason, r.c.label, r.query, day,
    ]);
    await withDbRetry(() =>
      db
        .prepare(
          `INSERT INTO ebay_asks (card_id, game, variant, price_usd, n, n_nm, median_usd, q75_usd, vintage, verdict, reason, label, query, day) VALUES ${values}
           ON CONFLICT(card_id, variant, game) DO UPDATE SET price_usd = excluded.price_usd, n = excluded.n, n_nm = excluded.n_nm,
             median_usd = excluded.median_usd, q75_usd = excluded.q75_usd, vintage = excluded.vintage, verdict = excluded.verdict, reason = excluded.reason,
             label = excluded.label, query = excluded.query, day = excluded.day`,
        )
        .run(...args),
    );
  }
}

async function callsToday(day: string): Promise<number> {
  const row = (await db.prepare("SELECT value FROM price_history_meta WHERE key = ?").get(`ebay_referee_${day}`)) as { value: string } | undefined;
  return Number(row?.value ?? 0);
}

async function saveCalls(day: string, n: number): Promise<void> {
  await db.prepare("INSERT INTO price_history_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(`ebay_referee_${day}`, String(n));
}

/** The nightly run: read as many due printings as today's call budget and the time limit allow. */
export async function runEbayReferee({ now = Date.now(), maxCalls = CALLS_PER_DAY, runMs = RUN_MS } = {}): Promise<RefereeRun> {
  const t0 = Date.now();
  const day = todayUtc(now);
  const verdicts: Record<RefereeVerdict, number> = { high: 0, check: 0, ok: 0, none: 0 };
  const base: RefereeRun = { candidates: 0, read: 0, calls: 0, verdicts, failed: 0, left: 0, ms: 0 };
  if (!isEbayConfigured()) return { ...base, skipped: "unconfigured" };
  const spent = await callsToday(day);
  if (spent >= maxCalls) return { ...base, skipped: "budget" };

  const [cands, lastRows] = await Promise.all([
    refereeCandidates(),
    db.prepare("SELECT card_id, game, variant, day, price_usd FROM ebay_asks").all() as unknown as Promise<{ card_id: string; game: string; variant: string; day: string; price_usd: number }[]>,
  ]);
  const last = new Map(lastRows.map((r) => [askKey(r.game, r.card_id, r.variant), { day: r.day, price: Number(r.price_usd) }]));
  // Unreadable printings (a prize card, a rare tag the matcher cannot require) cost no call: the big ones go to the hand-check list.
  const handOnly = cands.filter((c) => !refereeable(c.card) && c.price >= HAND_ONLY_MIN && (last.get(askKey(c.card.game, c.card.cardId, c.card.variant))?.day ?? "") < day);
  await writeRows(
    handOnly.map((c) => ({ c, reading: { n: 0, nNm: 0, median: null, q75: null, vintage: false }, verdict: "check" as const, reason: "prize or rare printing: eBay can't be read automatically", query: refereeQueries(c.card)[0] })),
    day,
  );
  const queue = refereeOrder(cands.filter((c) => refereeable(c.card)), last, day);
  let calls = spent;
  let failed = 0;
  const done: AskRow[] = [];
  let next = 0;
  const worker = async () => {
    // Each card can take two calls: stop when two more could cross the budget, or the time is nearly up.
    while (next < queue.length && calls + 2 <= maxCalls && Date.now() - t0 < runMs) {
      const c = queue[next++];
      try {
        const r = await readOne(c);
        calls += r.calls;
        done.push(r.row);
        verdicts[r.row.verdict]++;
      } catch (err) {
        failed++;
        calls++;
        if (failed <= 3) console.warn(`ebay referee: ${c.label} failed`, err);
        // eBay down or throttling: stop rather than burn the budget on errors.
        if (failed >= 10 && failed > done.length) break;
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  await writeRows(done, day);
  await saveCalls(day, calls);
  clearTrustMemo();
  verdicts.check += handOnly.length;
  const run: RefereeRun = { candidates: cands.length, read: done.length, calls: calls - spent, verdicts, failed, left: queue.length - done.length - failed, ms: Date.now() - t0 };
  await db
    .prepare("INSERT INTO price_history_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(META_KEY, JSON.stringify({ day, at: now, ...run }));
  return run;
}

/** The last run's summary for the admin page (null before the first run). */
export async function lastRefereeRun(): Promise<(RefereeRun & { day: string; at: number }) | null> {
  const row = (await db.prepare("SELECT value FROM price_history_meta WHERE key = ?").get(META_KEY)) as { value: string } | undefined;
  try {
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

export interface AskListRow {
  cardId: string;
  game: GameId;
  variant: string;
  label: string;
  query: string;
  price: number;
  n: number;
  nNm: number;
  median: number | null;
  q75: number | null;
  verdict: RefereeVerdict;
  reason: string;
  day: string;
  manual: "hide" | "keep" | null;
  manualPrice: number | null;
}

/** The admin lists: rows of a verdict, priciest first (fresh readings only; manual calls of any age under "manual"). */
export async function listAsks(kind: "high" | "check" | "manual", limit = 150, today = todayUtc()): Promise<AskListRow[]> {
  const since = addDays(today, -EBAY_REFEREE.maxAgeDays);
  const where = kind === "manual" ? "manual IS NOT NULL" : "verdict = ? AND day >= ? AND manual IS NULL";
  const args = kind === "manual" ? [limit] : [kind, since, limit];
  const rows = (await db
    .prepare(
      `SELECT card_id, game, variant, label, query, price_usd, n, n_nm, median_usd, q75_usd, verdict, reason, day, manual, manual_price
         FROM ebay_asks WHERE ${where} ORDER BY price_usd DESC LIMIT ?`,
    )
    .all(...args)) as unknown as {
    card_id: string; game: GameId; variant: string; label: string; query: string; price_usd: number; n: number; n_nm: number; median_usd: number | null;
    q75_usd: number | null; verdict: RefereeVerdict; reason: string; day: string; manual: "hide" | "keep" | null; manual_price: number | null;
  }[];
  return rows.map((r) => ({
    cardId: r.card_id, game: r.game, variant: r.variant, label: r.label, query: r.query, price: Number(r.price_usd), n: Number(r.n), nNm: Number(r.n_nm),
    median: r.median_usd == null ? null : Number(r.median_usd), q75: r.q75_usd == null ? null : Number(r.q75_usd), verdict: r.verdict, reason: r.reason,
    day: r.day, manual: r.manual, manualPrice: r.manual_price == null ? null : Number(r.manual_price),
  }));
}

/** Counts per verdict among fresh readings, for the admin header. */
export async function askCounts(today = todayUtc()): Promise<Record<RefereeVerdict | "manual", number>> {
  const since = addDays(today, -EBAY_REFEREE.maxAgeDays);
  const rows = (await db.prepare("SELECT verdict, COUNT(*) AS n FROM ebay_asks WHERE day >= ? AND manual IS NULL GROUP BY verdict").all(since)) as unknown as { verdict: RefereeVerdict; n: number }[];
  const manual = (await db.prepare("SELECT COUNT(*) AS n FROM ebay_asks WHERE manual IS NOT NULL").get()) as { n: number } | undefined;
  const out: Record<RefereeVerdict | "manual", number> = { high: 0, check: 0, ok: 0, none: 0, manual: Number(manual?.n ?? 0) };
  for (const r of rows) out[r.verdict] = Number(r.n);
  return out;
}

/** An admin's call after an eBay sold check: hide / keep binds at the price it was made on; clear hands the card back to the nightly rule. */
export async function setManualCall(game: GameId, cardId: string, variant: string, call: "hide" | "keep" | "clear", today = todayUtc()): Promise<boolean> {
  const res =
    call === "clear"
      ? await db.prepare("UPDATE ebay_asks SET manual = NULL, manual_price = NULL, manual_day = NULL WHERE game = ? AND card_id = ? AND variant = ?").run(game, cardId, variant)
      : await db
          .prepare("UPDATE ebay_asks SET manual = ?, manual_price = price_usd, manual_day = ? WHERE game = ? AND card_id = ? AND variant = ?")
          .run(call, today, game, cardId, variant);
  clearTrustMemo();
  return Number((res as { changes?: number }).changes ?? 0) > 0;
}
