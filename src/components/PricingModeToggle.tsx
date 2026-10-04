"use client";

import { useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { updateProfile } from "@/lib/client/accountApi";
import { toast } from "@/components/Toaster";

/**
 * Selling · Pricing only (10-04, docs/PRICING-ONLY-PLAN.md). Pricing only
 * hides the eBay selling UI; it never ends or deletes a listing. Flips on
 * tap (the session updates first, the save follows) and flips back if the
 * save fails.
 */
export default function PricingModeToggle({ onChange }: { onChange?: (pricingOnly: boolean) => void }) {
  const { user, patchUser } = useSession();
  const [saving, setSaving] = useState(false);
  if (!user) return null;
  const pricingOnly = Boolean(user.pricingOnly);

  async function choose(next: boolean) {
    if (next === pricingOnly || saving) return;
    setSaving(true);
    patchUser({ pricingOnly: next });
    onChange?.(next);
    try {
      await updateProfile({ pricingOnly: next });
    } catch {
      patchUser({ pricingOnly: !next });
      onChange?.(!next);
      toast("Couldn't save that, try again", "err");
    } finally {
      setSaving(false);
    }
  }

  const pill = (active: boolean) =>
    `whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
      active ? "bg-brand-500 text-white" : "text-zinc-400 hover:text-zinc-200"
    }`;
  return (
    <div role="group" aria-label="How you use CardFlip" className="inline-flex items-center gap-1 rounded-full border border-edge bg-black/25 p-1">
      <button type="button" aria-pressed={!pricingOnly} onClick={() => void choose(false)} className={pill(!pricingOnly)}>
        Selling
      </button>
      <button type="button" aria-pressed={pricingOnly} onClick={() => void choose(true)} className={pill(pricingOnly)}>
        Pricing only
      </button>
    </div>
  );
}
