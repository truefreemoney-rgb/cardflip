"use client";

import { formatMoney } from "@/lib/listing";
import { formatLocal, useHomeCurrency } from "@/lib/client/geo";

/**
 * A headline market price (Chris 09-30): US viewers see exactly formatMoney;
 * a CA/GB/IE/AU/NZ home sees "≈ £12.40" with the USD market price underneath
 * (the market, eBay and billing are all USD). Tables and charts stay USD.
 */
export default function Price({
  usd,
  className,
  usdClassName = "text-[11px] font-normal text-zinc-500",
}: {
  usd: number | null | undefined;
  className?: string;
  usdClassName?: string;
}) {
  const home = useHomeCurrency();
  if (usd == null || !Number.isFinite(usd) || usd === 0 || !home) return <span className={className}>{formatMoney(usd ?? null)}</span>;
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className={className}>{formatLocal(usd, home)}</span>
      <span className={usdClassName}>{formatMoney(usd)} USD</span>
    </span>
  );
}
