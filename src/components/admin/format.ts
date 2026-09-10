import type { BoardOwner } from "@/lib/server/board";

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
 * Server-rendered, so the zone is the server's — UTC on Vercel, local in dev.
 * The zone is printed because "Sep 4, 3:06 AM" on prod was read as local
 * time (issue #17); an ops page must say which clock it is on.
 */
export function fmtDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
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
export const ADMIN_NAV = [
  ["/admin", "Overview"],
  ["/admin/switches", "Switches"],
  ["/admin/board", "Tasks"],
  ["/admin/social", "Social"],
  ["/admin/users", "Users"],
  ["/admin/cards", "Cards"],
  ["/admin/errors", "Errors"],
  ["/admin/system", "System"],
] as const;
