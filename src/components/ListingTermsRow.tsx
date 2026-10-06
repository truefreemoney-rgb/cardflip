"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/basePath";
import { toast } from "@/components/Toaster";

/**
 * Account > Selling: the seller's opt-in listing terms. "Accept Offers" turns
 * on eBay Best Offer with an auto-accept and an auto-decline floor (a percent
 * of each listing's price); "Tracked Shipping" swaps the flat letter rate for
 * a tracked price above a threshold (shown only once the owner has switched it
 * on server-side). Both are off until the seller says so, and apply to
 * listings CardFlip sends or reprices from then on.
 */

interface Terms {
  acceptOffers: boolean;
  offerAcceptPercent: number;
  offerDeclinePercent: number;
  trackedShipOver: number | null;
  trackedShipCost: number | null;
  valueShippingLive: boolean;
}

const inputCls =
  "w-20 rounded-lg border border-edge bg-black/25 px-2.5 py-1.5 text-sm text-white outline-none focus:border-brand-500";
const btn =
  "shrink-0 rounded-full border border-edge px-3.5 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-edge-strong hover:text-white disabled:cursor-not-allowed disabled:opacity-50";
const primary =
  "shrink-0 rounded-full bg-brand-500 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50";
const label = "flex flex-wrap items-center gap-2 text-sm text-zinc-300";

export default function ListingTermsRow() {
  const [terms, setTerms] = useState<Terms | null>(null);
  const [accept, setAccept] = useState("90");
  const [decline, setDecline] = useState("70");
  const [over, setOver] = useState("50");
  const [cost, setCost] = useState("5.99");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function adopt(t: Terms) {
    setTerms(t);
    setAccept(String(t.offerAcceptPercent));
    setDecline(String(t.offerDeclinePercent));
    if (t.trackedShipOver != null) setOver(String(t.trackedShipOver));
    if (t.trackedShipCost != null) setCost(String(t.trackedShipCost));
  }

  useEffect(() => {
    let live = true;
    apiFetch("/api/ebay/listing-terms")
      .then((r) => (r.ok ? r.json() : null))
      .then((t: Terms | null) => {
        if (live && t) adopt(t);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function save(next: { acceptOffers: boolean; tracked: boolean }) {
    if (!terms || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/ebay/listing-terms", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acceptOffers: next.acceptOffers,
          offerAcceptPercent: Number(accept),
          offerDeclinePercent: Number(decline),
          ...(next.tracked ? { trackedShipOver: Number(over), trackedShipCost: Number(cost) } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Couldn't save that, try again.");
        return;
      }
      adopt(data as Terms);
      toast("Saved. New and repriced listings use it.");
    } catch {
      setError("Couldn't reach the server, try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!terms) return null;
  const trackedOn = terms.trackedShipOver != null;

  return (
    <>
      <div className="px-4 py-3.5 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-[10rem] flex-1">
            <p className="text-sm font-medium text-white">Accept Offers</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {terms.acceptOffers
                ? `On. Offers at ${terms.offerAcceptPercent}% of your price or more are accepted, under ${terms.offerDeclinePercent}% declined. Never below your break-even price.`
                : "Off. Buyers can't make offers. Turn on to let eBay accept and decline them for you."}
            </p>
          </div>
          <button
            type="button"
            className={terms.acceptOffers ? btn : primary}
            disabled={saving}
            onClick={() => void save({ acceptOffers: !terms.acceptOffers, tracked: trackedOn })}
          >
            {terms.acceptOffers ? "Turn off" : "Turn on"}
          </button>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <label className={label}>
            Auto-accept at
            <input inputMode="numeric" className={inputCls} value={accept} onChange={(e) => setAccept(e.target.value)} aria-label="Auto-accept percent of price" />
            % of price
          </label>
          <label className={label}>
            Auto-decline under
            <input inputMode="numeric" className={inputCls} value={decline} onChange={(e) => setDecline(e.target.value)} aria-label="Auto-decline percent of price" />
            % of price
          </label>
          <div>
            <button type="button" className={btn} disabled={saving} onClick={() => void save({ acceptOffers: terms.acceptOffers, tracked: trackedOn })}>
              Save percents
            </button>
          </div>
        </div>
      </div>

      {terms.valueShippingLive && (
        <div className="px-4 py-3.5 sm:px-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="min-w-[10rem] flex-1">
              <p className="text-sm font-medium text-white">Tracked Shipping</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {trackedOn
                  ? `On. Listings over $${terms.trackedShipOver} charge $${terms.trackedShipCost?.toFixed(2)} postage instead of the flat letter rate.`
                  : "Off. Every listing uses your flat letter rate."}
              </p>
            </div>
            <button
              type="button"
              className={trackedOn ? btn : primary}
              disabled={saving}
              onClick={() => void save({ acceptOffers: terms.acceptOffers, tracked: !trackedOn })}
            >
              {trackedOn ? "Turn off" : "Turn on"}
            </button>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <label className={label}>
              Tracked Shipping Over $
              <input inputMode="decimal" className={inputCls} value={over} onChange={(e) => setOver(e.target.value)} aria-label="Tracked shipping threshold in dollars" />
            </label>
            <label className={label}>
              Tracked postage price $
              <input inputMode="decimal" className={inputCls} value={cost} onChange={(e) => setCost(e.target.value)} aria-label="Tracked postage price in dollars" />
            </label>
            {trackedOn && (
              <div>
                <button type="button" className={btn} disabled={saving} onClick={() => void save({ acceptOffers: terms.acceptOffers, tracked: true })}>
                  Save shipping
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mx-4 mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300 sm:mx-5">
          {error}
        </p>
      )}
    </>
  );
}
