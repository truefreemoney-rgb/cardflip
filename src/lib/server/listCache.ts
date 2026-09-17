import "server-only";
import { db } from "@/lib/db";

/**
 * Small JSON memo on the card_cache table for whole-catalog lists (every set
 * in a mirror). Those queries are inherently a full index walk — 20k rows for
 * Pokémon, 94k for Magic — and Turso bills every row read, which is how the
 * free tier ran dry on 2026-09-06. The mirrors change once a day at most, so
 * one walk per TTL per key is the right cost.
 *
 * Failures on either side fall through to the builder: a cache that is down
 * must never take the feature with it.
 */
export async function cachedList<T>(key: string, ttlMs: number, build: () => Promise<T>, now = Date.now()): Promise<T> {
  try {
    const row = (await db.prepare("SELECT payload, cached_at FROM card_cache WHERE key = ?").get(key)) as
      | { payload: string; cached_at: number }
      | undefined;
    if (row && now - row.cached_at < ttlMs) return JSON.parse(row.payload) as T;
  } catch {
    // Cache miss is fine.
  }
  const value = await build();
  // Never memo an empty list: an unsynced mirror would pin "no sets" for a TTL.
  if (Array.isArray(value) && value.length === 0) return value;
  await db
    .prepare(
      `INSERT INTO card_cache (key, payload, cached_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, cached_at = excluded.cached_at`,
    )
    .run(key, JSON.stringify(value), now)
    .catch(() => {});
  return value;
}

/**
 * Stale-while-revalidate for memos too slow to block a page on. Fresh →
 * the value. Stale or missing → the old value (or the fallback) right now,
 * and the walk runs after the response (next/server after()). The admin
 * console's catalog block is ~10-15s of Turso COUNT(*)s on a cold memo,
 * which is past the function timeout: 09-16 the first admin visit after
 * the six-hour TTL returned nothing and sign-in sat on "Signing in…".
 */
export async function cachedListSwr<T>(
  key: string,
  ttlMs: number,
  build: () => Promise<T>,
  fallback: T,
  now = Date.now(),
): Promise<{ value: T; stale: boolean }> {
  let row: { payload: string; cached_at: number } | undefined;
  try {
    row = (await db.prepare("SELECT payload, cached_at FROM card_cache WHERE key = ?").get(key)) as typeof row;
  } catch {
    // Cache miss is fine.
  }
  if (row && now - row.cached_at < ttlMs) return { value: JSON.parse(row.payload) as T, stale: false };
  const refresh = async () => {
    try {
      const value = await build();
      await db
        .prepare(
          `INSERT INTO card_cache (key, payload, cached_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, cached_at = excluded.cached_at`,
        )
        .run(key, JSON.stringify(value), Date.now());
    } catch {
      // Next visit tries again.
    }
  };
  try {
    const { after } = await import("next/server");
    after(refresh);
  } catch {
    void refresh(); // outside a request (scripts): fire and forget
  }
  let stale: T = fallback;
  if (row) {
    try { stale = JSON.parse(row.payload) as T; } catch { /* keep fallback */ }
  }
  return { value: stale, stale: true };
}

/** Set lists refresh with the daily mirror sync; six hours is plenty. */
export const SET_LIST_TTL_MS = 6 * 60 * 60 * 1000;
