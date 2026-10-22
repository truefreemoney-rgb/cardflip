import "server-only";
import type { InValue } from "@libsql/client";
import { db } from "@/lib/db";

/**
 * Every row of a cards query, newest first, read in batches. The readers used
 * to take one LIMIT 400/600 slice while an account may hold up to 25,000 cards,
 * so refreshes and totals silently skipped the rest (10-22). `sql` is the SELECT
 * with its WHERE and no ORDER BY / LIMIT; rowid breaks created_at ties so the
 * pages never overlap.
 */
export async function pageAllCards<T>(sql: string, args: InValue[], batch: number): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += batch) {
    const part = (await db
      .prepare(`${sql} ORDER BY created_at DESC, rowid DESC LIMIT ${batch} OFFSET ${offset}`)
      .all(...args)) as unknown as T[];
    out.push(...part);
    if (part.length < batch) return out;
  }
}
