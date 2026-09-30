import "server-only";
import { getSetting, setSetting } from "@/lib/server/settings";
import { COUNTRY_CURRENCY } from "@/lib/countries";

/**
 * USD → home-currency rates for the "≈ £12.40" price hint (Chris 09-30).
 * ECB reference rates via Frankfurter (free, no key), cached in settings
 * fx_rates and refreshed at most every 12 hours on demand, so no cron and no
 * billing job depends on it. A failed fetch keeps the last good rates; no
 * rates at all = no hint (USD is always shown).
 */
export interface FxRates {
  /** ECB rate date (yyyy-mm-dd). */
  date: string;
  fetchedAt: number;
  /** 1 USD = rates[CUR] units. */
  rates: Record<string, number>;
}

const KEY = "fx_rates";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const WANTED = [...new Set(Object.values(COUNTRY_CURRENCY))].filter((c) => c !== "USD");

function parse(raw: string | null): FxRates | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as FxRates;
    return v && typeof v.date === "string" && v.rates && typeof v.fetchedAt === "number" ? v : null;
  } catch {
    return null;
  }
}

export async function getFxRates(now = Date.now()): Promise<FxRates | null> {
  const cached = parse(await getSetting(KEY));
  if (cached && now - cached.fetchedAt < MAX_AGE_MS) return cached;
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${WANTED.join(",")}`, {
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`frankfurter ${res.status}`);
    const body = (await res.json()) as { date?: string; rates?: Record<string, number> };
    const rates: Record<string, number> = {};
    for (const c of WANTED) {
      const r = body.rates?.[c];
      if (typeof r === "number" && r > 0 && r < 1000) rates[c] = r;
    }
    if (!body.date || Object.keys(rates).length !== WANTED.length) throw new Error("frankfurter: incomplete rates");
    const fresh: FxRates = { date: body.date, fetchedAt: now, rates };
    await setSetting(KEY, JSON.stringify(fresh));
    return fresh;
  } catch (err) {
    console.error("fx: rate refresh failed, keeping the last good rates:", err);
    return cached;
  }
}
