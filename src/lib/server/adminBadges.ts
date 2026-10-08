import "server-only";
import { db } from "@/lib/db";
import { errorCount24h } from "@/lib/server/errorLog";

/**
 * Count badges on the console nav (Chris 10-07): what needs a look, at a
 * glance. Support = open tickets whose last word isn't ours; Log = server
 * errors in the last 24 h; Users = accounts made in the last 24 h. Runs on
 * every console page, so three cheap counts, and a failure only hides the
 * badges, never the nav.
 */
export type AdminBadges = Partial<Record<"/admin/support" | "/admin/errors" | "/admin/users", { n: number; tone: "warn" | "good" }>>;

export async function adminBadges(now = Date.now()): Promise<AdminBadges> {
  try {
    const [support, errors, users] = await Promise.all([
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM support_tickets t
            WHERE t.status = 'open'
              AND COALESCE((SELECT n.author FROM support_ticket_notes n WHERE n.ticket_id = t.id ORDER BY n.created_at DESC LIMIT 1), '') != 'admin'`,
        )
        .get() as Promise<{ n: number } | undefined>,
      errorCount24h(),
      db.prepare("SELECT COUNT(*) AS n FROM users WHERE created_at > ?").get(now - 86_400_000) as Promise<{ n: number } | undefined>,
    ]);
    const out: AdminBadges = {};
    const s = Number(support?.n ?? 0);
    const u = Number(users?.n ?? 0);
    if (s > 0) out["/admin/support"] = { n: s, tone: "warn" };
    if (errors > 0) out["/admin/errors"] = { n: errors, tone: "warn" };
    if (u > 0) out["/admin/users"] = { n: u, tone: "good" };
    return out;
  } catch (err) {
    console.error("admin badges failed:", err);
    return {};
  }
}
