import "server-only";
import { db } from "@/lib/db";
import { blueskyLikeOwn, blueskySession } from "./sites/bluesky.ts";
import { xLikeOwn } from "./sites/x.ts";
import { facebookLikeOwn } from "./sites/meta.ts";

/**
 * Like our own posts (Chris 09-29: "we should like our own posts for
 * algorithm sake ... go back and like all the previous posts you can").
 * Each poster likes its new post the moment it goes up; this sweep runs
 * after every posts refresh (inbox cron + Refresh button) and likes any
 * stored post that is not in social_self_likes yet: the backfill, and a
 * retry for a like that failed at post time. Instagram, Threads and TikTok
 * have no like call in their APIs, so Chris likes those by hand.
 *
 * A site stops at its first failure per run (a missing permission or a rate
 * limit fails every post the same way) and tries again next sweep.
 */
export const SELF_LIKE_SITES = ["bluesky", "x", "facebook"] as const;

export interface SelfLikeReport {
  site: string;
  liked: number;
  error: string | null;
}

export async function likeOwnPosts(now = Date.now()): Promise<SelfLikeReport[]> {
  const out: SelfLikeReport[] = [];
  const mark = db.prepare("INSERT OR IGNORE INTO social_self_likes (site, post_id, at) VALUES (?, ?, ?)");
  for (const site of SELF_LIKE_SITES) {
    const rows = (await db
      .prepare(
        `SELECT p.post_id FROM social_posts p
         WHERE p.site = ? AND NOT EXISTS (SELECT 1 FROM social_self_likes l WHERE l.site = p.site AND l.post_id = p.post_id)
         ORDER BY p.at DESC LIMIT 50`,
      )
      .all(site)) as Array<{ post_id: string }>;
    const r: SelfLikeReport = { site, liked: 0, error: null };
    if (rows.length === 0) continue;
    try {
      const session = site === "bluesky" ? await blueskySession() : null;
      for (const { post_id } of rows) {
        if (site === "bluesky") {
          if (!session) throw new Error("not connected");
          if (await blueskyLikeOwn(post_id, session)) r.liked++;
        } else if (site === "x") {
          await xLikeOwn(post_id);
          r.liked++;
        } else {
          await facebookLikeOwn(post_id);
          r.liked++;
        }
        await mark.run(site, post_id, now);
      }
    } catch (err) {
      r.error = err instanceof Error ? err.message : String(err);
    }
    out.push(r);
  }
  return out;
}
