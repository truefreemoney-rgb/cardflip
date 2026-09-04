"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiPath } from "@/lib/client/basePath";
import RoleToggle from "@/components/admin/RoleToggle";
import ResetLinkButton from "@/components/admin/ResetLinkButton";
import type { Role, ScanTier } from "@/lib/server/users";
import type { UserRollup } from "@/lib/server/adminStats";

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  ebayConnected: boolean;
  createdAt: number;
  isDemo: boolean;
  tier: ScanTier;
  plan: "standard" | "pro" | null;
  scansUsed: number;
  monthlyScans: number;
  trialScansUsed: number;
}

function fmtDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Deterministic avatar hue per user, so a face stays the same between visits. */
function hue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

const TIER_STYLE: Record<ScanTier, { label: string; cls: string }> = {
  owner: { label: "Owner", cls: "bg-holo-gold/15 text-holo-gold" },
  subscribed: { label: "Subscribed", cls: "bg-emerald-400/10 text-emerald-300" },
  legacy: { label: "Legacy", cls: "bg-sky-400/10 text-sky-300" },
  trial: { label: "Trial", cls: "bg-white/5 text-zinc-400" },
};

function randomPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const GRID =
  "md:grid-cols-[minmax(0,2.2fr)_repeat(3,minmax(0,0.55fr))_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_2.5rem]";

/**
 * Users: search, sort, per-account rollups, an Add account form, and a row
 * that unfolds into its actions (reset link, role, delete) instead of three
 * buttons per line (Chris, 09-04: "full makeover").
 */
export default function AdminUsersTable({ users, rollups }: { users: AdminUserRow[]; rollups: Record<string, UserRollup> }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"joined" | "cards" | "revenue" | "active">("joined");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

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
      setOpenId(null);
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
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${sort === key ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Search users"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or email"
          className="w-full max-w-xs rounded-full border border-edge bg-surface-1 px-4 py-2 text-base text-white placeholder:text-zinc-600 focus:border-brand-400 focus:outline-none sm:text-sm"
        />
        <div className="flex items-center gap-0.5 rounded-full border border-edge bg-surface-1 p-0.5">
          {sortBtn("joined", "Newest")}
          {sortBtn("active", "Most active")}
          {sortBtn("cards", "Most cards")}
          {sortBtn("revenue", "Top revenue")}
        </div>
        <button
          onClick={() => setAdding((a) => !a)}
          aria-expanded={adding}
          className="ml-auto rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-400"
        >
          {adding ? "Close" : "+ Add account"}
        </button>
      </div>

      {adding && <AddAccountForm onDone={() => setAdding(false)} />}

      {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

      <div className="overflow-hidden rounded-2xl border border-edge bg-surface-1">
        <div className={`hidden items-center gap-3 border-b border-edge px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 md:grid ${GRID}`}>
          <span>User</span>
          <span className="text-right">Cards</span>
          <span className="text-right">Listed</span>
          <span className="text-right">Sold</span>
          <span className="text-right">Revenue</span>
          <span>Plan</span>
          <span>Joined</span>
          <span>Active</span>
          <span />
        </div>
        <ul className="divide-y divide-edge">
          {rows.map((u) => {
            const r = rollups[u.id];
            const open = openId === u.id;
            const tier = TIER_STYLE[u.tier];
            const scansLabel =
              u.tier === "trial"
                ? `${u.trialScansUsed}/10 trial scans`
                : u.tier === "legacy"
                  ? `${u.scansUsed}/100 today`
                  : u.tier === "owner"
                    ? "unlimited"
                    : `${u.scansUsed}/${u.monthlyScans} this month`;
            return (
              <li key={u.id} className={open ? "bg-white/[0.03]" : ""}>
                <button
                  onClick={() => setOpenId(open ? null : u.id)}
                  aria-expanded={open}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03] ${GRID}`}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                      style={{ background: `hsl(${hue(u.id)} 45% 32%)` }}
                    >
                      {initials(u.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-white">{u.name}</span>
                        {u.role === "admin" && <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-medium text-brand-300">admin</span>}
                        {u.isDemo && <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">demo</span>}
                        {u.ebayConnected && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" title="eBay connected" />}
                      </span>
                      <span className="block truncate text-xs text-zinc-500">{u.email}</span>
                      <span className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-zinc-500 md:hidden">
                        <span>{r?.cards ?? 0} cards</span>
                        <span>{r?.sold ?? 0} sold</span>
                        <span className="text-emerald-400">${(r?.revenue ?? 0).toFixed(2)}</span>
                        <span className={`rounded-full px-1.5 ${tier.cls}`}>{tier.label}</span>
                      </span>
                    </span>
                  </span>
                  <span className="hidden text-right tabular-nums text-zinc-300 md:block">{r?.cards ?? 0}</span>
                  <span className="hidden text-right tabular-nums text-zinc-300 md:block">{r?.listed ?? 0}</span>
                  <span className="hidden text-right tabular-nums text-zinc-300 md:block">{r?.sold ?? 0}</span>
                  <span className={`hidden text-right tabular-nums md:block ${r?.revenue ? "text-emerald-400" : "text-zinc-600"}`}>${(r?.revenue ?? 0).toFixed(2)}</span>
                  <span className="hidden min-w-0 md:block">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tier.cls}`}>{u.plan === "pro" ? "Pro" : tier.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-zinc-600">{scansLabel}</span>
                  </span>
                  <span className="hidden text-xs text-zinc-500 md:block">{fmtDate(u.createdAt)}</span>
                  <span className="hidden text-xs text-zinc-500 md:block">{fmtDate(r?.lastActive ?? null)}</span>
                  <span className={`justify-self-end text-zinc-600 transition ${open ? "rotate-180" : ""}`} aria-hidden>
                    ▾
                  </span>
                </button>
                {open && (
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-edge bg-black/20 px-4 py-3 md:pl-16">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] uppercase tracking-wider text-zinc-600">Password</span>
                      <ResetLinkButton userId={u.id} disabled={u.isDemo} />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] uppercase tracking-wider text-zinc-600">Role</span>
                      <RoleToggle userId={u.id} role={u.role} isSelf={false} />
                    </div>
                    <span className="text-[11px] text-zinc-500">{r?.wishlist ?? 0} on watchlist</span>
                    <button
                      onClick={() => remove(u)}
                      disabled={u.isDemo || busyId === u.id}
                      className="ml-auto rounded-full px-3 py-1 text-xs text-zinc-500 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      {busyId === u.id ? "Deleting…" : "Delete account"}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
          {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-500">{q ? "No users match." : "No users yet."}</li>}
        </ul>
      </div>
    </div>
  );
}

/** Inline creator: name, email, a generated (or typed) password, role. */
function AddAccountForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(() => randomPassword());
  const [role, setRole] = useState<Role>("user");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiPath("/api/admin/users"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't create the account");
      setCreated({ name, email, password });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the account");
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => window.prompt("Copy:", text));
  }

  const input =
    "w-full rounded-lg border border-edge bg-black/40 px-3 py-2 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400 sm:text-sm";

  if (created) {
    return (
      <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.06] p-4">
        <p className="text-sm font-medium text-emerald-200">
          Account created for {created.name} ({created.email}).
        </p>
        <p className="mt-1 text-xs text-emerald-200/70">Hand them this password. It shows once; after this, use Reset password on their row.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="rounded-md bg-black/40 px-2.5 py-1 font-mono text-sm text-white">{created.password}</code>
          <button
            onClick={() => copy(`${created.email}\n${created.password}`)}
            className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-zinc-200 transition hover:bg-white/15"
          >
            {copied ? "Copied ✓" : "Copy email + password"}
          </button>
          <button
            onClick={() => {
              setCreated(null);
              setName("");
              setEmail("");
              setPassword(randomPassword());
              setRole("user");
            }}
            className="text-xs text-zinc-400 transition hover:text-white"
          >
            Add another
          </button>
          <button onClick={onDone} className="text-xs text-zinc-500 transition hover:text-zinc-300">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-edge bg-surface-1 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.2fr_1fr_auto] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus placeholder="Jane Seller" className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="jane@example.com" className={input} />
        </label>
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Password
            <button type="button" onClick={() => setPassword(randomPassword())} className="normal-case tracking-normal text-brand-300 transition hover:text-brand-200">
              Generate
            </button>
          </span>
          <input value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className={`${input} font-mono`} />
        </label>
        <div className="flex items-center gap-2">
          <div className="flex rounded-full border border-edge bg-black/30 p-0.5 text-xs">
            {(["user", "admin"] as Role[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`rounded-full px-3 py-1.5 font-medium transition ${role === r ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                {r === "admin" ? "Admin" : "Seller"}
              </button>
            ))}
          </div>
          <button type="submit" disabled={busy} className="rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-400 disabled:opacity-50">
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-zinc-600">New accounts start on the 10-scan trial like a public signup. No email is sent; you hand over the password.</p>
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    </form>
  );
}
