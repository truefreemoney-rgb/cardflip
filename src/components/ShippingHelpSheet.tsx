"use client";

import Sheet from "@/components/Sheet";
import { SHIP_OPTIONS, shipSteps } from "@/lib/shipping";
import type { ShipMethod } from "@/lib/fees";

/**
 * "How to ship" pop-up (Chris 10-08: "I want it more apparent what is expected
 * of the seller when shipping"): both methods, step by step, the picked one
 * first and marked. Opened from the ? beside the Shipping heading in the scan
 * editor and from the "How to ship it" line on a live or sold card.
 */
export default function ShippingHelpSheet({ picked, onClose }: { picked: ShipMethod | null | undefined; onClose: () => void }) {
  const order = [...SHIP_OPTIONS].sort((a, b) => (a.id === picked ? -1 : b.id === picked ? 1 : 0));
  return (
    <Sheet onClose={onClose} title="How to ship a card" hint="Both ways, step by step. The postage is already in your price, so the buyer pays nothing for shipping." backId="ship-help">
      <div className="flex flex-col gap-4">
        {order.map((o) => (
          <section key={o.id} className={`rounded-xl border p-3.5 ${o.id === picked ? "border-brand-400/60 bg-brand-500/10" : "border-edge bg-surface-1"}`}>
            <h3 className="flex items-baseline justify-between gap-2 text-sm font-semibold text-white">
              <span>
                {o.label}
                {o.id === picked && <span className="ml-2 rounded-full bg-brand-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-300">Your pick</span>}
              </span>
              <span className="font-display text-sm">${o.postage.toFixed(2)} postage</span>
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">{o.sub}</p>
            <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-[13px] leading-snug text-zinc-300">
              {shipSteps(o.id).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
        ))}
        <p className="text-xs text-zinc-500">A sleeve and a toploader every time. eBay prints both labels; you never buy postage somewhere else.</p>
      </div>
    </Sheet>
  );
}
