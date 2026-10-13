"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPath } from "@/lib/client/basePath";

interface Props {
  game: string;
  cardId: string;
  variant: string;
  /** The call already made on this row, if any (then only Undo shows). */
  manual: "hide" | "keep" | null;
}

/**
 * /admin/prices: record an eBay SOLD check. Wrong = hide the price; Right = keep
 * it (also overrides the nightly eBay rule); Undo = back to the rule. A call
 * binds while the price stays within 10% of the price it was made on.
 */
export default function PriceCallButtons({ game, cardId, variant, manual }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(call: "hide" | "keep" | "clear") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiPath("/api/admin/prices"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game, cardId, variant, call }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't save.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  const btn = "rounded-full px-3 py-1 text-xs font-medium transition disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {manual ? (
        <button onClick={() => send("clear")} disabled={busy} className={`${btn} bg-white/5 text-zinc-300 hover:bg-white/10`}>
          {busy ? "…" : "Undo"}
        </button>
      ) : (
        <>
          <button onClick={() => send("hide")} disabled={busy} className={`${btn} bg-red-400/10 text-red-300 hover:bg-red-400/20`}>
            Wrong, hide
          </button>
          <button onClick={() => send("keep")} disabled={busy} className={`${btn} bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20`}>
            Right, keep
          </button>
        </>
      )}
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </div>
  );
}
