/**
 * Next fire time of a Vercel Cron expression, in UTC (Vercel evaluates every
 * schedule in UTC). Only the daily "M H * * *" shape is computed — that is
 * the only shape vercel.json uses — so anything else returns null and the
 * caller shows the raw expression instead of guessing.
 *
 * Pure so scripts/test-admin.mjs can pin it without a server import.
 */
export function nextCronRun(expr: string, now = Date.now()): number | null {
  const m = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/.exec(expr.trim());
  if (!m) return null;
  const minute = Number(m[1]);
  const hour = Number(m[2]);
  if (minute > 59 || hour > 23) return null;
  const d = new Date(now);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, minute);
  return today > now ? today : today + 86_400_000;
}

/** "09:45 UTC" for the daily shape; the raw expression for anything else. */
export function cronLabel(expr: string): string {
  const m = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/.exec(expr.trim());
  if (!m) return expr;
  return `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")} UTC daily`;
}
