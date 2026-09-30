"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiPath } from "@/lib/client/basePath";
import { etDate } from "@/lib/time";

interface LedgerLine {
  credit_key: string;
  kind: string;
  scans: number;
  applied: number;
  note: string | null;
  created_at: number;
}

interface Props {
  userId: string;
  /** Plan scans on the account now (an unmigrated subscriber's seed counts). */
  planScans: number;
}

/**
 * Admin, owner only: add or take back plan scans by hand, with a note, as a
 * ledger row (POST /api/admin/users/[id]/scans). This is how a refund without a
 * cancel takes its scans back, how a won dispute or a goodwill grant is put
 * right, and how a missed credit is fixed. A negative number floors at zero.
 * The answer names what really moved and lists the newest ledger rows.
 */
export default function AdjustScansControl({ userId, planScans }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ line: string; ledger: LedgerLine[] } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(delta);
    if (!Number.isInteger(n) || n === 0) {
      setError("Type a whole number of scans, like 250 or -250.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(apiPath(`/api/admin/users/${userId}/scans`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta: n, note: note.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't adjust the scans.");
      const moved = Number(data.applied) || 0;
      const short = moved !== n ? ` (asked for ${n > 0 ? "+" : ""}${n.toLocaleString("en-US")}; a balance stops at zero)` : "";
      setResult({
        line: `${moved > 0 ? "Added" : moved < 0 ? "Took back" : "Changed nothing:"} ${Math.abs(moved).toLocaleString("en-US")} scans${short}. Plan scans now ${Number(data.balanceAfter ?? 0).toLocaleString("en-US")}.`,
        ledger: Array.isArray(data.ledger) ? (data.ledger as LedgerLine[]).slice(0, 5) : [],
      });
      setDelta("");
      setNote("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't adjust the scans.");
    } finally {
      setBusy(false);
    }
  }

  const input =
    "rounded-lg border border-edge bg-black/40 px-3 py-2 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400 sm:text-sm";

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto">
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-zinc-600">Plan scans</span>
        <span className="text-xs tabular-nums text-zinc-300">{planScans.toLocaleString("en-US")}</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-zinc-400 transition hover:bg-white/10"
        >
          {open ? "Close" : "Adjust Scans"}
        </button>
      </div>
      {open && (
        <form onSubmit={submit} className="flex flex-col gap-2 rounded-xl border border-edge bg-surface-1 p-3 sm:w-96">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">Scans to add or take back</span>
            <input
              inputMode="numeric"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="250 or -250"
              required
              className={`w-full ${input}`}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">Why (kept in the ledger)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Refunded the Oct 25 payment"
              required
              minLength={3}
              maxLength={300}
              className={`w-full ${input}`}
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="self-start rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-400 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Apply"}
          </button>
          {error && (
            <p role="alert" className="text-xs text-red-300">
              {error}
            </p>
          )}
          {result && (
            <div role="status" className="text-xs text-emerald-300">
              <p>{result.line}</p>
              {result.ledger.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-[11px] text-zinc-500">
                  {result.ledger.map((l) => (
                    <li key={l.credit_key} className="truncate">
                      {etDate(l.created_at, "—", { month: "short", day: "numeric" })} · {l.kind} · {l.applied > 0 ? "+" : ""}
                      {l.applied.toLocaleString("en-US")}
                      {l.note ? ` · ${l.note}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
