import Link from "next/link";

/** The one plan, as a card. Shared by the landing page and /pricing so the
 *  price, the scan count and the bullet list can't drift apart. */
export const PLAN = {
  price: "$9.99",
  scans: 500,
  lines: [
    "500 card scans a month, camera or photos",
    "Card reading with condition and 1st Edition detection",
    "Live TCGplayer market price for the exact printing and variant",
    "eBay listings written, published and repriced from CardFlip",
    "Inventory with categories, sort by value or rarity, sales tracking",
    "Watchlist with price alerts and 90-day history",
  ],
};

function Check() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}

export default function PlanCard({ cta = "Start scanning", className = "" }: { cta?: string; className?: string }) {
  return (
    <div className={`foil-edge relative overflow-hidden rounded-3xl p-8 [--foil-fill:#0b0d13] sm:p-10 ${className}`}>
      <div className="pointer-events-none absolute right-0 top-0 h-48 w-48 translate-x-1/3 -translate-y-1/3 rounded-full bg-brand-500/25 blur-3xl" aria-hidden />
      <div className="relative">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-display text-lg font-semibold text-white">CardFlip</p>
            <p className="mt-1 text-sm text-zinc-500">{PLAN.scans} scans a month</p>
          </div>
          <p className="text-right">
            <span className="font-display text-5xl font-bold tracking-tight text-white">{PLAN.price}</span>
            <span className="text-sm text-zinc-500">/month</span>
          </p>
        </div>

        <ul className="mt-8 space-y-3 text-sm text-zinc-300">
          {PLAN.lines.map((line) => (
            <li key={line} className="flex items-start gap-2.5">
              <Check />
              {line}
            </li>
          ))}
        </ul>

        <Link
          href="/signup"
          className="sheen mt-8 block w-full rounded-full bg-brand-500 px-7 py-3.5 text-center text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-400"
        >
          {cta}
        </Link>
        <p className="mt-3 text-center text-xs text-zinc-500">Cancel any time. You keep 100% of every eBay payout.</p>
      </div>
    </div>
  );
}
