"use client";

import { planPriceLabel, type PaidPlan } from "@/lib/pricing";
import { useViewerCurrency } from "@/lib/client/geo";

/**
 * A plan's price in the viewer's currency (Chris 09-30 local prices,
 * pricing.ts LOCAL_PRICING): £7.99 for a UK home or visitor, $9.99 for
 * everyone else. Checkout bills the same amount (checkoutCurrency).
 */
export default function PlanPrice({ plan }: { plan: PaidPlan | "pack" }) {
  return <>{planPriceLabel(plan, useViewerCurrency())}</>;
}
