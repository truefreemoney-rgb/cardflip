"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPath } from "@/lib/client/basePath";

/**
 * eBay local markets switch (admin console, docs/EBAY_COUNTRIES_PLAN.md).
 * Off is how the site ships: every seller lists on eBay US in dollars. On lets
 * a seller whose home country AND eBay account both say CA, GB, IE or AU list
 * on their own eBay site, but only for a site whose row is live:true in
 * src/lib/marketplaces.ts (every row ships live:false; the owner flips them
 * one at a time after the sandbox run, see the plan's go-live steps).
 */
export default function EbayLocalMarketsSwitch({ on: initial }: { on: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip() {
    const next = !on;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(apiPath("/api/admin/settings"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ebayLocalMarkets: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't save");
      setOn(Boolean(data.ebayLocalMarkets));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-200">eBay local markets</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {on
              ? "On. Sellers from CA, GB, IE and AU whose eBay account is registered there list on their own eBay site, for each site whose row is live in the code. A site that is not live still lists on eBay US."
              : "Off. Every seller lists on eBay US in dollars, as always."}
          </p>
        </div>
        <button
          onClick={flip}
          disabled={pending}
          role="switch"
          aria-checked={on}
          aria-label="eBay local markets on"
          className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${on ? "bg-emerald-500" : "bg-zinc-700"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${on ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
