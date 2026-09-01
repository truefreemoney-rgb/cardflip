"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPath } from "@/lib/client/basePath";
import RoleToggle from "@/components/admin/RoleToggle";
import ResetLinkButton from "@/components/admin/ResetLinkButton";
import type { Role } from "@/lib/server/users";
import type { UserRollup } from "@/lib/server/adminStats";

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  ebayConnected: boolean;
  createdAt: number;
  isDemo: boolean;
}

function fmtDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

/** Searchable, sortable users table with per-user rollups and a guarded delete. */
export default function AdminUsersTable({ users, rollups }: { users: AdminUserRow[]; rollups: Record<string, UserRollup> }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"joined" | "cards" | "revenue" | "active">("joined");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = users.filter((u) => !needle || u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle));
    const r = (id: string) => rollups[id];
    return list.sort((a, b) => {
      if (sort === "cards") return (r(b.id)?.cards ?? 0) - (r(a.id)?.cards ?? 0);
      if (sort === "revenue") return (r(b.id)?.revenue ?? 0) - (r(a.id)?.revenue ?? 0);
      if (sort === "active") return (r(b.id)?.lastActive ?? 0) - (r(a.id)?.lastActive ?? 0);
      return b.createdAt - a.createdAt;
    });
  }, [users, rollups, q, sort]);

  async function remove(u: AdminUserRow) {
    const rl = rollups[u.id];
    if (!window.confirm(`Delete ${u.name} (${u.email})?\n\nThis removes their ${rl?.cards ?? 0} cards, ${rl?.wishlist ?? 0} watchlist items and sessions. It can't be undone.`)) return;
    setBusyId(u.id);
    setError(null);
    try {
      const res = await fetch(apiPath(`/api/admin/users/${u.id}`), { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  const sortBtn = (key: typeof sort, label: string) => (
    <button
      onClick={() => setSort(key)}
      className={`rounded-full px-2.5 py-1 text-xs transition ${sort === key ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          type="search"
          aria-label="Search users"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or email"
          className="w-full max-w-xs rounded-full border border-edge bg-surface-1 px-4 py-2 text-base text-white placeholder:text-zinc-600 focus:border-brand-400 focus:outline-none sm:text-sm"
        />
        <div className="flex items-center gap-1 rounded-full bg-black/30 p-0.5">
          {sortBtn("joined", "Newest")}
          {sortBtn("active", "Most active")}
          {sortBtn("cards", "Most cards")}
          {sortBtn("revenue", "Top revenue")}
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
      <div className="overflow-x-auto rounded-2xl border border-edge bg-surface-1">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/5 text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 text-right font-medium">Cards</th>
              <th className="px-4 py-3 text-right font-medium">Listed</th>
              <th className="px-4 py-3 text-right font-medium">Sold</th>
              <th className="px-4 py-3 text-right font-medium">Revenue</th>
              <th className="px-4 py-3 font-medium">eBay</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium">Active</th>
              <th className="px-4 py-3 font-medium">Password</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium text-right"> </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const r = rollups[u.id];
              return (
                <tr key={u.id} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">
                      {u.name}
                      {u.isDemo && <span className="ml-2 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">demo</span>}
                    </div>
                    <div className="text-xs text-zinc-500">{u.email}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-300">{r?.cards ?? 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-300">{r?.listed ?? 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-300">{r?.sold ?? 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-400">${(r?.revenue ?? 0).toFixed(2)}</td>
                  <td className="px-4 py-3">{u.ebayConnected ? <span className="text-emerald-400">Connected</span> : <span className="text-zinc-600">—</span>}</td>
                  <td className="px-4 py-3 text-zinc-500">{fmtDate(u.createdAt)}</td>
                  <td className="px-4 py-3 text-zinc-500">{fmtDate(r?.lastActive ?? null)}</td>
                  <td className="px-4 py-3"><ResetLinkButton userId={u.id} disabled={u.isDemo} /></td>
                  <td className="px-4 py-3"><RoleToggle userId={u.id} role={u.role} isSelf={false} /></td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => remove(u)}
                      disabled={u.isDemo || busyId === u.id}
                      className="rounded-full px-2.5 py-1 text-xs text-zinc-500 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      {busyId === u.id ? "Deleting…" : "Delete"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={11} className="px-4 py-6 text-center text-zinc-500">{q ? "No users match." : "No users yet."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
