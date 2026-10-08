import type { BoardOwner } from "@/lib/server/board";
import type { ScanTier } from "@/lib/server/users";
import { etDateTime } from "@/lib/time";

/** Formatting shared by the admin console pages (app/admin/(console)/*). */

/**
 * Display-only rename: Chris doesn't want his name shown in the console.
 * The stored value (and docs/BOARD.md's [Chris]/[both] tags) stay as-is —
 * this only decides what the chip says.
 */
export function ownerLabel(owner: BoardOwner): string {
  if (owner === "Chris") return "Admin";
  if (owner === "both") return "Admin / Claude";
  return owner ?? "—";
}

export function money(v: number): string {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function num(v: number): string {
  return v.toLocaleString("en-US");
}
export function bytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${Math.round(b / 1e3)} KB`;
}
/**
 * Eastern, labelled "ET" (Chris 09-30: the Errors page still showed UTC).
 * Was the server's zone — UTC on Vercel — with the zone printed because
 * "Sep 4, 3:06 AM" on prod was read as local time (issue #17).
 */
export function fmtDate(ts: number | null): string {
  return ts ? etDateTime(ts) : "—";
}
/** "3 h ago" / "2 d ago" — relative, so no zone question at all. */
export function ago(ts: number | null, now = Date.now()): string {
  if (!ts) return "never";
  const m = Math.round((now - ts) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
export function uptime(sec: number): string {
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} h`;
  return `${(sec / 86400).toFixed(1)} d`;
}

/**
 * Plan pill per scan tier. Here, not in AdminUsersTable, so the server-
 * rendered Active Users page can read it too (a "use client" module's
 * plain objects are not readable from a server component).
 */
export const TIER_STYLE: Record<ScanTier, { label: string; cls: string }> = {
  owner: { label: "Owner", cls: "bg-holo-gold/15 text-holo-gold" },
  subscribed: { label: "Subscribed", cls: "bg-emerald-400/10 text-emerald-300" },
  legacy: { label: "Legacy", cls: "bg-sky-400/10 text-sky-300" },
  pack: { label: "Booster", cls: "bg-amber-400/10 text-amber-300" },
  trial: { label: "Trial", cls: "bg-white/5 text-zinc-400" },
};

export const STATUS_STYLE: Record<string, string> = {
  ready: "bg-zinc-400/10 text-zinc-300",
  listed: "bg-sky-400/10 text-sky-300",
  ended: "bg-amber-400/10 text-amber-300",
  sold: "bg-emerald-400/10 text-emerald-300",
};

/**
 * The console's pages, in nav order. Each is its own route under /admin.
 * "Prices & data" (/admin/data) is gone on purpose (issue #21): its page was
 * never committed — an unanchored `data/` in .gitignore hid the folder — so
 * the pill 404'd on prod, and everything it showed (price history, daily
 * refresh, mirrors, storage) already lives on /admin/system.
 */
export const ADMIN_NAV_GROUPS: ReadonlyArray<{ label: string; pages: ReadonlyArray<readonly [string, string]> }> = [
  { label: "Money", pages: [["/admin", "Overview"], ["/admin/analytics", "Analytics"], ["/admin/adtest", "Ad Test"], ["/admin/emails", "Emails"]] },
  { label: "People", pages: [["/admin/users", "Users"], ["/admin/waitlist", "Waitlist"], ["/admin/support", "Support"]] },
  { label: "Content", pages: [["/admin/social", "Social"], ["/admin/cards", "Cards"], ["/admin/drop", "Drop"]] },
  { label: "Settings", pages: [["/admin/switches", "Switches"], ["/admin/board", "Tasks"], ["/admin/errors", "Log"], ["/admin/system", "System"]] },
];

/** Every page, flat, in nav order. */
export const ADMIN_NAV = ADMIN_NAV_GROUPS.flatMap((g) => g.pages);
