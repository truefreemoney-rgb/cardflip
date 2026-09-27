"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPath } from "@/lib/client/basePath";
import { daysUntil, monthlyTotal, nextDue, PERIODS, perMonth, type Expense, type Period } from "@/lib/expenses";

/** "due today", "in 3 days", "12 days ago" for the row's next billing day. */
function dueLabel(e: Expense): { text: string; soon: boolean } | null {
  const next = nextDue(e);
  if (!next) return null;
  const n = daysUntil(next);
  if (n === 0) return { text: "due today", soon: true };
  if (n < 0) return { text: `${-n} day${n === -1 ? "" : "s"} ago`, soon: false };
  return { text: `in ${n} day${n === 1 ? "" : "s"}`, soon: n <= 7 };
}

/**
 * The expense table under Money on /admin/analytics. Every row is editable in
 * place (name, amount, per month / year / once, note, confirmed); Save puts
 * the whole list back. Seeded rows say "Confirm" until Chris ticks them.
 */
export default function Expenses({ expenses: initial, metered }: { expenses: Expense[]; metered: { usd: number; scans: number } }) {
  const router = useRouter();
  const [rows, setRows] = useState<Expense[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit(i: number, patch: Partial<Expense>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setDirty(true);
  }
  function remove(i: number) {
    setRows((prev) => prev.filter((_, j) => j !== i));
    setDirty(true);
  }
  function add() {
    setRows((prev) => [...prev, { id: `row-${Date.now()}`, name: "", amountUsd: 0, period: "month", confirmed: true }]);
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(apiPath("/api/admin/expenses"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expenses: rows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't save");
      setRows(data.expenses ?? rows);
      setDirty(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  const total = Math.round((monthlyTotal(rows) + metered.usd) * 100) / 100;
  const unconfirmed = rows.filter((r) => !r.confirmed).length;
  const input = "w-full rounded-lg border border-edge bg-black/30 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-brand-400/60";

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-zinc-200">Expenses</p>
        <p className="text-[11px] text-zinc-500">
          {unconfirmed > 0 ? `${unconfirmed} to confirm · ` : ""}one-offs are not in the monthly total · dates roll forward on their own
        </p>
      </div>
      <ul className="divide-y divide-white/5">
        <li className="grid grid-cols-[1fr_auto] items-center gap-x-2 py-2 text-xs">
          <div className="min-w-0">
            <p className="text-zinc-100">Anthropic API (scan tokens)</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Measured, last 30 days · {metered.scans.toLocaleString()} scan{metered.scans === 1 ? "" : "s"} · billed monthly by usage, so no fixed amount
            </p>
          </div>
          <span className="tabular-nums text-rose-300">${metered.usd.toFixed(2)}/mo</span>
        </li>
        {rows.map((r, i) => (
          <li key={r.id} className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 py-2 sm:grid-cols-[minmax(0,1.3fr)_5.5rem_5.5rem_8.5rem_minmax(0,1.4fr)_auto_auto] sm:items-center">
            <input className={input} value={r.name} placeholder="What" aria-label="Name" onChange={(e) => edit(i, { name: e.target.value })} />
            <div className="flex items-center gap-1 sm:contents">
              <input
                className={`${input} w-24 sm:w-full`}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={Number.isFinite(r.amountUsd) ? r.amountUsd : ""}
                aria-label="Amount in dollars"
                onChange={(e) => edit(i, { amountUsd: e.target.value === "" ? 0 : Number(e.target.value) })}
              />
              <select className={`${input} w-24 sm:w-full`} value={r.period} aria-label="How often" onChange={(e) => edit(i, { period: e.target.value as Period })}>
                {PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {p === "month" ? "per month" : p === "year" ? "per year" : "one-off"}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 sm:block">
              <input className={`${input} w-36 sm:w-full`} type="date" value={r.dueDate ?? ""} aria-label="Due date" onChange={(e) => edit(i, { dueDate: e.target.value })} />
              {(() => {
                const d = dueLabel(r);
                return d ? <span className={`text-[11px] sm:mt-0.5 sm:block ${d.soon ? "text-amber-300" : "text-zinc-500"}`}>{d.text}</span> : null;
              })()}
            </div>
            <input className={`${input} col-span-2 sm:col-span-1`} value={r.note ?? ""} placeholder="Note" aria-label="Note" onChange={(e) => edit(i, { note: e.target.value })} />
            <label className={`flex items-center gap-1.5 text-[11px] ${r.confirmed ? "text-zinc-500" : "text-amber-300"}`}>
              <input type="checkbox" checked={r.confirmed} onChange={(e) => edit(i, { confirmed: e.target.checked })} className="accent-emerald-500" />
              {r.confirmed ? "Confirmed" : "Confirm"}
            </label>
            <div className="flex items-center justify-end gap-2 text-[11px] tabular-nums text-zinc-500">
              <span>{r.period === "once" ? "—" : `$${perMonth(r).toFixed(2)}/mo`}</span>
              <button type="button" onClick={() => remove(i)} aria-label={`Remove ${r.name || "row"}`} className="rounded px-1 text-zinc-600 hover:bg-white/5 hover:text-rose-300">
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-3">
        <button type="button" onClick={add} className="rounded-full border border-edge px-3 py-1 text-xs text-zinc-300 hover:bg-white/5">
          + Add expense
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs tabular-nums text-zinc-400">
            <span className="text-rose-300">${total.toFixed(2)}</span> / month
          </span>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-full bg-brand-500 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-brand-400 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}
