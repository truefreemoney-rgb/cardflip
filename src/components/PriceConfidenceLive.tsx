"use client";

import { useEffect, useState } from "react";
import PriceConfidenceBadge from "@/components/PriceConfidenceBadge";
import { loadSeries, pickSeries } from "@/lib/client/priceHistoryData";

/**
 * The confidence badge for the app's card detail: reads the same cached series the chart uses (one request shared),
 * and shows nothing until it arrives or if there is no dollar series. Days = recorded points of the quote's series.
 */
export default function PriceConfidenceLive({ cardId, variant, className = "" }: { cardId: string; variant?: string | null; className?: string }) {
  const [state, setState] = useState<{ id: string; days: number; staleDays: number | null } | null>(null);
  useEffect(() => {
    if (!cardId) return;
    let alive = true;
    loadSeries(cardId)
      .then((all) => {
        const s = pickSeries(all, variant);
        if (alive && s && s.points.length > 0 && !s.untrusted) setState({ id: cardId, days: s.points.length, staleDays: s.stale?.days ?? null });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [cardId, variant]);
  if (!state || state.id !== cardId) return null;
  return <PriceConfidenceBadge days={state.days} staleDays={state.staleDays} className={className} />;
}
