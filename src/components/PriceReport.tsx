"use client";

import { useState } from "react";
import { BASE_PATH, apiFetch } from "@/lib/client/basePath";
import { TAP_8, TAP_LINK } from "@/lib/tap";

/**
 * "Price looks wrong?" under a card page's price (A-H #9, 10-17). Two taps: open, then too high / too low. The vote
 * goes to /admin/prices ("Readers flagged"), where the price is checked against eBay sold. No sign-in needed; one
 * vote per visitor per card (a second tap changes it).
 */
export default function PriceReport({ variant, price, className = "" }: { variant: string; price: number; className?: string }) {
  const [state, setState] = useState<"closed" | "open" | "busy" | "done" | "error">("closed");

  const send = async (direction: "high" | "low") => {
    setState("busy");
    try {
      const path = window.location.pathname.slice(BASE_PATH.length);
      const res = await apiFetch("/api/price-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, variant, direction, price }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  };

  if (state === "done") {
    return (
      <p className={`text-sm text-emerald-300 ${className}`} role="status">
        Thanks. We&apos;ll check it against real eBay sales.
      </p>
    );
  }
  if (state === "closed") {
    return (
      <button type="button" onClick={() => setState("open")} className={`${TAP_LINK} block text-sm text-zinc-400 underline underline-offset-2 transition hover:text-zinc-200 ${className}`}>
        Price looks wrong?
      </button>
    );
  }
  return (
    <div className={`flex flex-wrap items-center gap-2 text-sm ${className}`}>
      <span className="text-zinc-300">{state === "error" ? "That didn't send. Try again:" : "Is it too high or too low?"}</span>
      {(["high", "low"] as const).map((d) => (
        <button
          key={d}
          type="button"
          disabled={state === "busy"}
          onClick={() => send(d)}
          className={`${TAP_8} rounded-full border border-edge bg-surface-1 px-3 py-1 text-zinc-200 transition hover:border-zinc-500 disabled:opacity-50`}
        >
          Too {d}
        </button>
      ))}
    </div>
  );
}
