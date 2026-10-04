"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPath } from "@/lib/client/basePath";
import { daysUntil, monthlyTotal, nextDue, PERIODS, perMonth, type Expense, type Period } from "@/lib/expenses";

/** "Due today", "Due in 3 days", "Paid 12 days ago" for the row's billing day. */
function dueLabel(e: Expense): { text: string; soon: boolean } | null {
  const next = nextDue(e);
  if (!next) return null;
  const n = daysUntil(next);
  if (n === 0) return { text: e.period === "once" ? "Paid today" : "Due today", soon: true };
  if (n < 0) return { text: `Paid ${-n} day${n === -1 ? "" : "s"} ago`, soon: false };
  return { text: `Due in ${n} day${n === 1 ? "" : "s"}`, soon: n <= 7 };
}

const PERIOD_LABEL: Record<Period, string> = { month: "Every month", year: "Every year", once: "One time" };

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

/**
 * The expense list under Money on /admin/analytics. Rows read as plain text;
 * tapping one opens it as a small labeled form. Seeded amounts I guessed
 * carry a "Looks Right" button so Chris can confirm them in one tap. Save
 * puts the whole list back.
 */
export default function Expenses({ expenses: initial }: { expenses: Expense[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Expense[]>(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit(id: string, patch: Partial<Expense>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
  }
  function remove(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
    if (open === id) setOpen(null);
    setDirty(true);
  }
  function add() {
    const id = `row-${Date.now()}`;
    setRows((prev) => [...prev, { id, name: "", amountUsd: 0, period: "month", confirmed: true }]);
    setOpen(id);
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
      setOpen(null);
      setDirty(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  const total = Math.round(monthlyTotal(rows) * 100) / 100;
  const unconfirmed = rows.filter((r) => !r.confirmed).length;
  const recurring = rows.filter((r) => r.period !== "once");
  const oneOffs = rows.filter((r) => r.period === "once");
  const input = "w-full rounded-lg border border-edge bg-black/30 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-brand-400/60";

  // A plain render function, not a nested component: a nested component would remount on every keystroke and drop focus.
  function renderRow(r: Expense) {
    const due = dueLabel(r);
    if (open === r.id) {
      return (
        <li key={r.id} className="py-2">
          <div className="rounded-xl border border-brand-400/40 bg-black/20 p-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.4fr)_6.5rem_8rem_9.5rem]">
              <Field label="Name" className="col-span-2 sm:col-span-1">
                <input className={input} value={r.name} placeholder="Vercel Pro" autoFocus onChange={(e) => edit(r.id, { name: e.target.value })} />
              </Field>
              <Field label="Amount">
                <input
                  className={input}
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={Number.isFinite(r.amountUsd) ? r.amountUsd : ""}
                  onChange={(e) => edit(r.id, { amountUsd: e.target.value === "" ? 0 : Number(e.target.value) })}
                />
              </Field>
              <Field label="How often">
                <select className={input} value={r.period} onChange={(e) => edit(r.id, { period: e.target.value as Period })}>
                  {PERIODS.map((p) => (
                    <option key={p} value={p}>
                      {PERIOD_LABEL[p]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={r.period === "once" ? "Paid on" : "Next bill"}>
                <input className={input} type="date" value={r.dueDate ?? ""} onChange={(e) => edit(r.id, { dueDate: e.target.value })} />
              </Field>
              <Field label="Note" className="col-span-2 sm:col-span-4">
                <input className={input} value={r.note ?? ""} placeholder="What it is for" onChange={(e) => edit(r.id, { note: e.target.value })} />
              </Field>
              <Field label="Billing page" className="col-span-2 sm:col-span-4">
                <input
                  className={input}
                  type="url"
                  inputMode="url"
                  value={r.billingUrl ?? ""}
                  placeholder="Paste the link to this service's billing page"
                  onChange={(e) => edit(r.id, { billingUrl: e.target.value })}
                />
              </Field>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <button type="button" onClick={() => remove(r.id)} className="text-xs text-zinc-500 hover:text-rose-300">
                Remove
              </button>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-zinc-300">
                  <input type="checkbox" checked={r.confirmed} onChange={(e) => edit(r.id, { confirmed: e.target.checked })} className="accent-emerald-500" />
                  Amount is right
                </label>
                <button type="button" onClick={() => setOpen(null)} className="rounded-full border border-edge px-3 py-1 text-xs text-zinc-200 hover:bg-white/5">
                  Done
                </button>
              </div>
            </div>
          </div>
        </li>
      );
    }
    return (
      <li key={r.id} className="flex items-center gap-3 py-2.5">
        <button type="button" onClick={() => setOpen(r.id)} className="min-w-0 flex-1 rounded-lg text-left hover:bg-white/[.03]" title="Tap to change">
          <p className="truncate text-sm text-zinc-100">{r.name || <span className="text-zinc-500">Untitled</span>}</p>
          <p className="truncate text-[11px] text-zinc-500">
            {!r.confirmed && <span className="text-amber-300">My guess · </span>}
            {due && <span className={due.soon ? "text-amber-300" : ""}>{due.text}</span>}
            {due && r.note ? " · " : ""}
            {r.note}
            {r.period === "year" ? `${due || r.note ? " · " : ""}$${perMonth(r).toFixed(2)} a month` : ""}
          </p>
        </button>
        {r.billingUrl && (
          <a
            href={r.billingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-full border border-edge px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-white/5"
          >
            Billing ↗
          </a>
        )}
        {!r.confirmed && (
          <button
            type="button"
            onClick={() => edit(r.id, { confirmed: true })}
            className="shrink-0 rounded-full border border-amber-300/40 bg-amber-300/10 px-2.5 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-300/20"
          >
            Looks Right
          </button>
        )}
        <p className="w-24 shrink-0 text-right tabular-nums">
          <span className="font-display text-base font-semibold text-zinc-100">${r.amountUsd.toFixed(2)}</span>
          <span className="text-[11px] text-zinc-500">{r.period === "once" ? "" : r.period === "year" ? "/yr" : "/mo"}</span>
        </p>
      </li>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-zinc-200">Expenses</p>
        <p className="text-right text-[11px] text-zinc-500">
          {unconfirmed > 0 ? (
            <>
              <span className="text-amber-300">{unconfirmed} amount{unconfirmed === 1 ? " is" : "s are"} my guess.</span> Tap Looks Right, or tap the row to fix it.
            </>
          ) : (
            "Tap a row to change it."
          )}
        </p>
      </div>

      <p className="mb-1 mt-3 text-[10px] font-medium uppercase tracking-wide text-zinc-500">Every month</p>
      <ul className="divide-y divide-white/5">
        {recurring.map(renderRow)}
      </ul>

      {oneOffs.length > 0 && (
        <>
          <p className="mb-1 mt-4 text-[10px] font-medium uppercase tracking-wide text-zinc-500">One time · not in the monthly total</p>
          <ul className="divide-y divide-white/5">
            {oneOffs.map(renderRow)}
          </ul>
        </>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
        <button type="button" onClick={add} className="rounded-full border border-edge px-3 py-1 text-xs text-zinc-300 hover:bg-white/5">
          + Add Expense
        </button>
        <div className="flex items-center gap-3">
          <p className="text-right tabular-nums">
            <span className="font-display text-lg font-semibold text-rose-300">${total.toFixed(2)}</span>
            <span className="text-[11px] text-zinc-500"> every month</span>
          </p>
          {dirty && (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-full bg-brand-500 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-brand-400 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}
