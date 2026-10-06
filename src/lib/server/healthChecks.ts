import "server-only";
import { db } from "@/lib/db";
import { reportServerError } from "@/lib/server/errorLog";
import { etDateTime, etDay } from "@/lib/time";

/**
 * "Did the robots run?" checks (audit F6 + F13). Two things can stop silently:
 *   - the nightly Turso backup, which runs from the owner's PC
 *     (scripts/backup-turso.mjs stamps BACKUP_META_KEY into price_history_meta
 *     after a verified dump, so the server can see when it last worked), and
 *   - the daily price run (dailyJobs.ts stamps daily_finished_at).
 * The overview's "Needs you" rows read staleChecks(); reportStaleOnceADay()
 * also writes one Errors-page line per Eastern day so it is seen without a visit.
 */

export const BACKUP_META_KEY = "backup_last_ok";
const ALERT_DAY_KEY = "stale_alert_day";
export const BACKUP_STALE_MS = 30 * 3_600_000;
export const PRICE_STALE_MS = 36 * 3_600_000;

export interface StaleItem {
  key: "backup" | "prices";
  tone: "warn" | "bad";
  /** Plain-words line, relative age plus Eastern time. */
  text: string;
  href: string;
}

async function metaGet(key: string): Promise<string | null> {
  const row = (await db.prepare("SELECT value FROM price_history_meta WHERE key = ?").get(key)) as { value: string } | undefined;
  return row?.value ?? null;
}

function hoursAgo(at: number, now: number): string {
  const h = Math.round((now - at) / 3_600_000);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** Pure: which of the two are stale at `now`. `at` null = never recorded. Amber past the limit, red past double. */
export function staleItems(backupAt: number | null, priceAt: number | null, now: number): StaleItem[] {
  const out: StaleItem[] = [];
  if (!backupAt) {
    out.push({ key: "backup", tone: "bad", text: "No database backup on record yet (the nightly backup on your PC has not reported in)", href: "/admin/system" });
  } else if (now - backupAt > BACKUP_STALE_MS) {
    out.push({
      key: "backup",
      tone: now - backupAt > 2 * BACKUP_STALE_MS ? "bad" : "warn",
      text: `Last database backup was ${hoursAgo(backupAt, now)} (${etDateTime(backupAt)}). Is your PC on?`,
      href: "/admin/system",
    });
  }
  if (!priceAt) {
    out.push({ key: "prices", tone: "bad", text: "No finished price run on record", href: "/admin/system" });
  } else if (now - priceAt > PRICE_STALE_MS) {
    out.push({
      key: "prices",
      tone: now - priceAt > 2 * PRICE_STALE_MS ? "bad" : "warn",
      text: `Last price run finished ${hoursAgo(priceAt, now)} (${etDateTime(priceAt)})`,
      href: "/admin/system",
    });
  }
  return out;
}

/** Reads both timestamps. Never throws: an unreadable meta row just shows as "not on record". */
export async function staleChecks(now = Date.now()): Promise<StaleItem[]> {
  try {
    const [b, p] = await Promise.all([metaGet(BACKUP_META_KEY), metaGet("daily_finished_at")]);
    return staleItems(Number(b) || null, Number(p) || null, now);
  } catch {
    return [];
  }
}

/** One Errors-page line per stale item, at most once per Eastern day. Never throws. */
export async function reportStaleOnceADay(now = Date.now()): Promise<number> {
  try {
    const items = await staleChecks(now);
    if (items.length === 0) return 0;
    const day = etDay(now);
    if ((await metaGet(ALERT_DAY_KEY)) === day) return 0;
    await db.prepare("INSERT OR REPLACE INTO price_history_meta (key, value) VALUES (?, ?)").run(ALERT_DAY_KEY, day);
    for (const i of items) await reportServerError(`stale:${i.key}`, new Error(i.text));
    return items.length;
  } catch {
    return 0;
  }
}
