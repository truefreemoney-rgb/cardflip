import "server-only";
import { randomUUID } from "node:crypto";
import { format } from "node:util";
import { db } from "@/lib/db";

/**
 * Error-only monitoring, self-hosted in the app's own database. The site
 * promises "no analytics profile" in /privacy, so this records faults, not
 * people: source + message + stack, nothing about who was browsing.
 *
 * Writers: instrumentation.ts onRequestError (every unhandled route error)
 * plus explicit reportServerError calls in jobs. Reader: the admin console's
 * Errors section. Ring buffer: the newest MAX_ROWS lines, never older than
 * 30 days, pruned on every write.
 *
 * Server log (10-03): instrumentation.ts also routes every server-side
 * console.warn / console.error here (level 'warn' | 'error', source
 * 'console'), because three times in one day the cause of a prod fault lived
 * only in Vercel's runtime logs. Warnings are shown on /admin/errors but do
 * not count toward the error KPI or the digest email.
 */

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Ring-buffer size — "a few hundred" lines is enough to read a bad day. */
const MAX_ROWS = 500;

/** The ring buffer may overshoot MAX_ROWS by up to ten minutes of writes. */
const PRUNE_EVERY_MS = 10 * 60 * 1000;
let lastPrune = 0;

/** Tests only: make the next write prune again. */
export function _resetErrorLogPrune(): void {
  lastPrune = 0;
}

export type LogLevel = "error" | "warn";

export interface ErrorEvent {
  id: string;
  at: number;
  source: string;
  level: LogLevel;
  message: string;
  stack: string | null;
  digest: string | null;
}

/** Never throws — a broken error logger must not take the request down with it. */
export async function reportServerError(
  source: string,
  err: unknown,
  digest?: string,
  level: LogLevel = "error",
): Promise<void> {
  try {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack.slice(0, 4000) : null;
    const now = Date.now();
    await db.prepare(
      "INSERT INTO error_events (id, at, source, level, message, stack, digest) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(randomUUID(), now, source.slice(0, 200), level, message.slice(0, 1000), stack, digest ?? null);
    // Pruned at most once per PRUNE_EVERY_MS per process: a log storm used to
    // run the prune (a ~500-row read on Turso) after every single warning.
    if (now - lastPrune >= PRUNE_EVERY_MS) {
      lastPrune = now;
      // One statement: age cutoff + row cap together, both off idx_error_events_at
      // (the cap is "older than the MAX_ROWS-th newest row"; ties are kept).
      await db
        .prepare(
          "DELETE FROM error_events WHERE at < ? OR at < (SELECT at FROM error_events ORDER BY at DESC LIMIT 1 OFFSET ?)",
        )
        .run(now - RETENTION_MS, MAX_ROWS - 1);
    }
  } catch {
    // Last resort only — the original error is already being handled upstream.
  }
}

/** Writes allowed in flight at once — a log storm must not pile up Turso calls. */
const MAX_IN_FLIGHT = 8;
const NODE_WARNING = /^\(node:\d+\) /;

/**
 * Route console.warn / console.error through the log. Idempotent (HMR,
 * repeated register() calls). reportServerError never logs to the console
 * itself, so db.ts's own console.error on a failed schema probe adds one row
 * and stops; the sync guard covers anything format() might print.
 */
export function captureConsole(): void {
  const g = globalThis as { __cardflipConsoleCaptured?: boolean };
  if (g.__cardflipConsoleCaptured) return;
  g.__cardflipConsoleCaptured = true;
  let inside = false;
  let inFlight = 0;
  const hook = (level: LogLevel, original: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      original(...args);
      if (inside || inFlight >= MAX_IN_FLIGHT) return;
      inside = true;
      try {
        const firstErr = args.find((a): a is Error => a instanceof Error);
        const text = format(...args).slice(0, 1000);
        // Node's own process warnings ("(node:4) ExperimentalWarning: vm...")
        // fire on every cold start and are not ours to fix — skip them.
        if (NODE_WARNING.test(text)) return;
        // Carry the stack when one was logged; the message is the whole line.
        const payload = firstErr ? Object.assign(new Error(text), { stack: firstErr.stack }) : text;
        inFlight++;
        void reportServerError("console", payload, undefined, level).finally(() => {
          inFlight--;
        });
      } catch {
        // never throws into the caller's console call
      } finally {
        inside = false;
      }
    };
  console.error = hook("error", console.error.bind(console));
  console.warn = hook("warn", console.warn.bind(console));
}

export async function listRecentErrors(limit = 50, level?: LogLevel): Promise<ErrorEvent[]> {
  const rows = (level
    ? await db.prepare("SELECT * FROM error_events WHERE level = ? ORDER BY at DESC LIMIT ?").all(level, limit)
    : await db.prepare("SELECT * FROM error_events ORDER BY at DESC LIMIT ?").all(limit)) as unknown as ErrorEvent[];
  return rows;
}

/** How many lines of each level the ring buffer holds right now — the Log page's filter counts. */
export async function logLevelCounts(): Promise<Record<LogLevel, number>> {
  const rows = (await db.prepare("SELECT level, COUNT(*) AS n FROM error_events GROUP BY level").all()) as unknown as { level: LogLevel; n: number }[];
  const out: Record<LogLevel, number> = { error: 0, warn: 0 };
  for (const r of rows) if (r.level in out) out[r.level] = r.n;
  return out;
}

/** Errors in the last 24h — the admin KPI tile. */
export async function errorCount24h(): Promise<number> {
  const row = (await db
    .prepare("SELECT COUNT(*) AS n FROM error_events WHERE level = 'error' AND at > ?")
    .get(Date.now() - 24 * 60 * 60 * 1000)) as { n: number } | undefined;
  return row?.n ?? 0;
}

export interface ErrorGroup {
  source: string;
  message: string;
  count: number;
  lastAt: number;
}

/** Last-24h errors grouped by source + message, busiest first — the digest email body. */
export async function errorGroups24h(limit = 10): Promise<ErrorGroup[]> {
  const rows = (await db
    .prepare(
      "SELECT source, message, COUNT(*) AS count, MAX(at) AS lastAt FROM error_events WHERE level = 'error' AND at > ? GROUP BY source, message ORDER BY count DESC, lastAt DESC LIMIT ?",
    )
    .all(Date.now() - 24 * 60 * 60 * 1000, limit)) as unknown as ErrorGroup[];
  return rows;
}
