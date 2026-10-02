"use client";

import { useState } from "react";

/**
 * The daily optimization loop's switch on /admin/social (Chris 10-02): on,
 * the 8am job may trial the benched post kind at 7am or 7pm for a week and
 * keep it only if it does at least as well; off, it scores and reports and
 * the schedule stays as it is. The line beside it is what the job last said.
 */
export default function SocialOptimizer({ on: initial, day, why }: { on: boolean; day: string | null; why: string | null }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function flip() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/social/posts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "optimizer", on: !on }) });
      const j = (await res.json()) as { optimizer?: boolean; error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setOn(j.optimizer === true);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-edge px-3 py-2 text-sm">
      <button
        type="button"
        onClick={flip}
        disabled={busy}
        role="switch"
        aria-checked={on}
        title={on ? "The 8am job may trial a different post at 7am or 7pm for a week. Press to freeze the schedule." : "The schedule is frozen. Press to let the 8am job run trials."}
        className={`rounded-full border px-3 py-1 ${on ? "border-emerald-400/50 text-emerald-300" : "border-edge text-zinc-400"} disabled:opacity-40`}
      >
        Optimizer {on ? "On" : "Off"}
      </button>
      <span className="min-w-0 flex-1 text-zinc-400">{note ?? (why ? `${day}: ${why}` : "First run is at 8am ET.")}</span>
    </div>
  );
}
