import Link from "next/link";

/**
 * Free trial · CardFlip · Pro, as matching cards (Chris, 09-04). Shared by
 * the landing page and /pricing so prices, scan counts and bullets can't
 * drift apart. Only the scan cap separates the paid tiers — on purpose.
 */
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

export const PRO = {
  price: "$24.99",
  scans: 2000,
  lines: [
    "2,000 card scans a month, camera or photos",
    "Everything in CardFlip",
    "Built for a few hundred cards a week",
    "Same live pricing, same eBay publishing",
    "Switch between plans any time in billing",
    "Cancel any time",
  ],
};

export const TRIAL = {
  scans: 10,
  lines: [
    "10 card scans, camera or photos",
    "The whole product, nothing held back",
    "Live pricing, eBay publishing, inventory, watchlist",
    "No card on file",
    "Everything you scan stays on the account",
    "Subscribe whenever the binder outgrows it",
  ],
};

function Check() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}

function Card({
  name,
  sub,
  price,
  per,
  lines,
  cta,
  note,
  primary,
}: {
  name: string;
  sub: string;
  price: string;
  per: string;
  lines: string[];
  cta: string;
  note: string;
  primary: boolean;
}) {
  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-3xl p-7 sm:p-8 ${
        primary ? "foil-edge [--foil-fill:#0b0d13]" : "border border-edge bg-surface-1"
      }`}
    >
      {primary && (
        <div className="pointer-events-none absolute right-0 top-0 h-48 w-48 translate-x-1/3 -translate-y-1/3 rounded-full bg-brand-500/25 blur-3xl" aria-hidden />
      )}
      <div className="relative flex flex-1 flex-col">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-display text-lg font-semibold text-white">{name}</p>
            <p className="mt-1 text-sm text-zinc-500">{sub}</p>
          </div>
          <p className="text-right">
            <span className="font-display text-5xl font-bold tracking-tight text-white">{price}</span>
            <span className="text-sm text-zinc-500">{per}</span>
          </p>
        </div>

        <ul className="mt-7 flex-1 space-y-3 text-sm text-zinc-300">
          {lines.map((line) => (
            <li key={line} className="flex items-start gap-2.5">
              <Check />
              {line}
            </li>
          ))}
        </ul>

        <Link
          href="/signup"
          className={`mt-7 block w-full rounded-full px-7 py-3.5 text-center text-sm font-semibold transition ${
            primary
              ? "sheen bg-brand-500 text-white shadow-lg shadow-brand-500/25 hover:bg-brand-400"
              : "border border-edge-strong bg-white/5 text-white hover:bg-white/10"
          }`}
        >
          {cta}
        </Link>
        <p className="mt-3 text-center text-xs text-zinc-500">{note}</p>
      </div>
    </div>
  );
}

export default function PlanCard({ className = "" }: { className?: string }) {
  return (
    <div className={`grid gap-3 md:grid-cols-3 ${className}`}>
      <Card
        name="Free trial"
        sub={`${TRIAL.scans} scans to start`}
        price="$0"
        per=""
        lines={TRIAL.lines}
        cta="Try 10 scans free"
        note="No card needed. Takes a minute to set up."
        primary={false}
      />
      <Card
        name="CardFlip"
        sub={`${PLAN.scans} scans a month`}
        price={PLAN.price}
        per="/month"
        lines={PLAN.lines}
        cta="Subscribe · $9.99/mo"
        note="Cancel any time. You keep 100% of every eBay payout."
        primary
      />
      <Card
        name="Pro"
        sub={`${PRO.scans.toLocaleString("en-US")} scans a month`}
        price={PRO.price}
        per="/month"
        lines={PRO.lines}
        cta="Go Pro · $24.99/mo"
        note="For volume sellers. Cancel any time."
        primary={false}
      />
    </div>
  );
}
