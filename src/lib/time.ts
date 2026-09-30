/**
 * Every time the site SHOWS is Eastern (Chris 09-30: "make sure the site is
 * using EST time site wide"). Vercel renders server pages in UTC and a
 * browser renders in the viewer's own zone, so a bare toLocaleString shows
 * a different clock depending on where it ran; these always say Eastern,
 * and the ones with a time of day end in "ET" (EST or EDT, whichever is in
 * effect). Display only: stored timestamps and the UTC day keys the price
 * history uses (priceSeries.todayUtc) do not change. Safe on server and client.
 */
export const ET_ZONE = "America/New_York";

type When = number | string | Date | null | undefined;

function toDate(v: When): Date | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Sep 30, 6:22 AM ET" (adds the year when it is not this year's). */
export function etDateTime(v: When, empty = "—"): string {
  const d = toDate(v);
  if (!d) return empty;
  const sameYear = etYear(d) === etYear(new Date());
  return `${d.toLocaleString("en-US", { timeZone: ET_ZONE, month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), hour: "numeric", minute: "2-digit" })} ET`;
}

/** "Sep 30, 2026" — the Eastern calendar day. */
export function etDate(v: When, empty = "—", opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }): string {
  const d = toDate(v);
  return d ? d.toLocaleDateString("en-US", { ...opts, timeZone: ET_ZONE }) : empty;
}

/** "6:22 AM ET". */
export function etTime(v: When, empty = "—"): string {
  const d = toDate(v);
  return d ? `${d.toLocaleTimeString("en-US", { timeZone: ET_ZONE, hour: "numeric", minute: "2-digit" })} ET` : empty;
}

/** "2026-09-30" — the Eastern day, for grouping rows by the day Chris lives in. */
export function etDay(v: When = Date.now()): string {
  const d = toDate(v) ?? new Date();
  return new Intl.DateTimeFormat("en-CA", { timeZone: ET_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * The instant Eastern midnight starts v's Eastern day, as epoch ms ("Today"
 * on the admin Active Users tab). EDT midnight is 04:00 UTC and EST is
 * 05:00; the day-change test picks the right one on a DST switch day too.
 */
export function etDayStart(v: When = Date.now()): number {
  const day = etDay(v);
  const [y, m, d] = day.split("-").map(Number);
  for (const h of [4, 5]) {
    const t = Date.UTC(y, m - 1, d, h);
    if (etDay(t) === day && etDay(t - 1) !== day) return t;
  }
  return Date.UTC(y, m - 1, d, 5);
}

function etYear(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: ET_ZONE, year: "numeric" }).format(d);
}
