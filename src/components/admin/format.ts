/** Formatting shared by the admin console pages (app/admin/(console)/*). */

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
export function fmtDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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

/** The console's pages, in nav order. Each is its own route under /admin. */
export const ADMIN_NAV = [
  ["/admin", "Overview"],
  ["/admin/switches", "Switches"],
  ["/admin/board", "Board"],
  ["/admin/users", "Users"],
  ["/admin/cards", "Cards"],
  ["/admin/data", "Prices & data"],
  ["/admin/errors", "Errors"],
  ["/admin/system", "System"],
] as const;
