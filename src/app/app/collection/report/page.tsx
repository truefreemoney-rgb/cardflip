"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PageSkeleton from "@/components/PageSkeleton";
import { useSession } from "@/components/SessionProvider";
import { apiPath } from "@/lib/client/basePath";
import { fetchServerCards, type ServerCard } from "@/lib/client/cardsApi";
import { POSTAGE_USD } from "@/lib/fees";
import { formatMoney } from "@/lib/listing";
import { saleBreakdown, saleYear, saleYears, yearTotals } from "@/lib/profit";
import { etDate } from "@/lib/time";

/**
 * Sales report (09-27): one year at a time, every sale with what it sold
 * for, eBay's fee, postage, what the seller paid and the profit, plus the
 * totals an accountant wants. Download gives the same as CSV. Nothing here
 * is editable: purchase prices are set on the card in Inventory.
 */
export default function SalesReportPage() {
  const { status, user } = useSession();
  const pricingOnly = Boolean(user?.pricingOnly);
  const [cards, setCards] = useState<ServerCard[] | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (status !== "ready") return;
    let live = true;
    void fetchServerCards().then((c) => {
      if (!live) return;
      if (c) setCards(c);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [status, tick]);

  const years = useMemo(() => (cards ? saleYears(cards) : []), [cards]);
  const shown = year ?? years[0] ?? Number(etDate(new Date(), "", { year: "numeric" }));
  const totals = useMemo(() => (cards ? yearTotals(cards, shown) : null), [cards, shown]);
  const sales = useMemo(
    () =>
      (cards ?? [])
        .filter((c) => c.status === "sold" && c.soldPrice != null && c.soldAt != null && saleYear(c.soldAt) === shown)
        .sort((a, b) => b.soldAt! - a.soldAt!),
    [cards, shown],
  );
  const day = (ts: number) => etDate(ts, "", { month: "short", day: "numeric" });
  const signed = (v: number) => (
    <span className={v < 0 ? "text-rose-400" : "text-emerald-400"}>
      {v < 0 ? "−" : ""}{formatMoney(Math.abs(v))}
    </span>
  );

  if (failed && !cards) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center gap-3 px-4 py-16 text-center">
        <h1 className="font-display text-xl font-semibold text-white">Couldn&apos;t load your sales</h1>
        <p className="text-sm text-zinc-400">Check your connection and try again.</p>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setTick((n) => n + 1);
          }}
          className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400"
        >
          Retry
        </button>
      </main>
    );
  }
  if (status !== "ready" || !cards || !totals) return <PageSkeleton />;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-8 sm:px-6">
      <div>
        <Link href="/app/collection" className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline">
          ← Inventory
        </Link>
        <h1 className="mt-1 font-display text-2xl font-semibold text-white">Sales report</h1>
        <p className="mt-1 text-sm text-zinc-500">{pricingOnly ? "Every sale in a year with what you paid and the profit." : "Every sale in a year with fees, postage, what you paid and the profit."} Eastern time dates.</p>
      </div>

      {/* Year pills + download */}
      <div className="flex flex-wrap items-center gap-2">
        {(years.length ? years : [shown]).map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => setYear(y)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              y === shown ? "bg-white text-black" : "border border-edge bg-surface-1 text-zinc-300 hover:text-white"
            }`}
          >
            {y}
          </button>
        ))}
        {totals.sales > 0 && (
          <a
            href={apiPath(`/api/cards/report?year=${shown}`)}
            className="ml-auto rounded-full border border-brand-400/40 bg-brand-500/10 px-3.5 py-1.5 text-sm font-semibold text-brand-300 transition hover:bg-brand-500/20"
          >
            Download {shown} CSV
          </a>
        )}
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(
          [
            ["Sales", String(totals.sales)],
            ["Sold for", formatMoney(totals.gross)],
            // Pricing only (10-04): no fee or postage tiles unless an eBay sale carried some.
            ...(pricingOnly && totals.fees === 0 && totals.postage === 0
              ? []
              : ([
                  [`eBay fees${totals.feesEstimated ? " (some est.)" : ""}`, `−${formatMoney(totals.fees)}`],
                  ["Postage", `−${formatMoney(totals.postage)}`],
                ] as [string, string][])),
            ["What you paid", `−${formatMoney(totals.cost)}`],
          ] as [string, string][]
        ).map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-edge bg-surface-1 p-4">
            <p className="font-display text-xl font-semibold tabular-nums text-white">{value}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{label}</p>
          </div>
        ))}
        <div className="rounded-2xl border border-edge bg-surface-1 p-4">
          <p className="font-display text-xl font-semibold tabular-nums">{signed(totals.profit)}</p>
          <p className="mt-0.5 text-xs text-zinc-500">Profit</p>
        </div>
      </div>

      {totals.costMissing > 0 && (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200">
          {totals.costMissing} sale{totals.costMissing === 1 ? "" : "s"} {totals.costMissing === 1 ? "has" : "have"} no purchase price. Open the card in Inventory and tap
          &ldquo;Add what you paid&rdquo; and the profit here updates.
        </p>
      )}

      {/* Rows */}
      <div className="overflow-hidden rounded-2xl border border-edge bg-surface-1">
        {sales.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">No sales in {shown}. It fills in as cards sell.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {sales.map((c) => {
              const b = saleBreakdown(c)!;
              return (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate text-sm text-zinc-100">
                      {c.cardName} <span className="text-zinc-500">· {c.setName} #{c.cardNumber}</span>
                    </p>
                    <p className="shrink-0 font-display text-sm font-semibold tabular-nums">{signed(b.profit)}</p>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500 tabular-nums">
                    {day(c.soldAt!)} · sold {formatMoney(b.gross)} · {b.byHand ? (pricingOnly ? "marked sold" : "marked by hand, no fees or postage") : `fees${b.feesActual ? "" : " est."} ${formatMoney(b.fees)} · postage ${formatMoney(b.postage)}`} ·{" "}
                    {b.costKnown ? `paid ${formatMoney(b.cost)}` : "no purchase price"}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-xs text-zinc-600">
        {!(pricingOnly && totals.fees === 0 && totals.postage === 0) && <>Fees are eBay&rsquo;s actual final value fee where CardFlip has synced it, otherwise 13.25% + $0.30 per order ($0.40 over $10). Postage is a flat {formatMoney(POSTAGE_USD)} allowance per sale. A sale you marked by hand carries no eBay fee and no postage.{" "}</>}
        Check {pricingOnly && totals.fees === 0 && totals.postage === 0 ? "these" : "both"} against your own records before filing.
      </p>
    </main>
  );
}
