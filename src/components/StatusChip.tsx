import type { ScanStatus } from "@/lib/types";
import Spinner from "@/components/Spinner";

const STYLES: Record<ScanStatus, { label: string; className: string; title?: string }> = {
  queued: { label: "Queued", className: "bg-white/5 text-zinc-400" },
  scanning: { label: "Scanning", className: "bg-brand-500/15 text-brand-300" },
  review: {
    label: "Check match",
    className: "bg-amber-400/10 text-amber-300",
    // "Ready" = one printing matched; this = several did (or none) — the top
    // pick is applied and priced, but the seller should glance at the
    // alternatives before it ships anywhere (confused Chris, 09-02).
    title: "More than one printing matched — open the card and check it's the right one",
  },
  ready: { label: "Ready", className: "bg-emerald-400/10 text-emerald-400", title: "Matched exactly one printing" },
  listed: { label: "Live on eBay", className: "bg-ebay/15 text-sky-300" },
  sold: { label: "Sold", className: "bg-emerald-500/20 text-emerald-300" },
  error: { label: "Failed", className: "bg-red-500/10 text-red-400" },
};

export default function StatusChip({ status }: { status: ScanStatus }) {
  const { label, className, title } = STYLES[status];

  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        status === "scanning" ? "chip-working animate-pulse" : ""
      } ${className}`}
    >
      {status === "scanning" && <Spinner className="h-3 w-3" />}
      {(status === "ready" || status === "listed") && (
        <span
          className={`h-1.5 w-1.5 rounded-full ${status === "ready" ? "bg-emerald-400" : "bg-sky-400"}`}
        />
      )}
      {status === "sold" && <span aria-hidden>🎉</span>}
      {label}
    </span>
  );
}
