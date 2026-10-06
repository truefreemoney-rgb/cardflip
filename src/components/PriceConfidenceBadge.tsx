import { priceConfidence, type ConfidenceLevel } from "@/lib/priceConfidence";

const DOT: Record<ConfidenceLevel, string> = { solid: "bg-emerald-400", fair: "bg-sky-400", thin: "bg-amber-400" };

/** One small line under or beside a market price: how much history stands behind it (lib/priceConfidence.ts). No client state. */
export default function PriceConfidenceBadge({ days, staleDays, className = "" }: { days: number; staleDays?: number | null; className?: string }) {
  const c = priceConfidence(days, staleDays);
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] leading-tight text-zinc-400 ${className}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[c.level]}`} aria-hidden />
      {c.text}
    </span>
  );
}
