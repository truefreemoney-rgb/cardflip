import type { ScanStatus } from "@/lib/types";
import Spinner from "@/components/Spinner";

const STYLES: Record<ScanStatus, { label: string; className: string; title?: string }> = {
  queued: { label: "Queued", className: "bg-white/5 text-zinc-400" },
  scanning: { label: "Scanning", className: "bg-brand-500/15 text-brand-300" },
  // Every match starts as "Verify match" (Chris, 09-03): the seller has to
  // confirm the identified card against the one in hand before it can be
  // published. `review` is the same ask with a stronger hint (shaky read or
  // several printings) — the editor opens the alternatives for it.
  review: {
    label: "Verify match",
    className: "bg-amber-400/10 text-amber-300",
    title: "The photo didn't pin this down — open the card, check the match, then verify it",
  },
  ready: {
    label: "Verify match",
    className: "bg-amber-400/10 text-amber-300",
    title: "Open the card and confirm it's the right one before it can be listed",
  },
  listed: { label: "Live on eBay", className: "bg-ebay/15 text-sky-300" },
  sold: { label: "Sold", className: "bg-emerald-500/20 text-emerald-300" },
  error: { label: "Failed", className: "bg-red-500/10 text-red-400" },
};

const ACTIVE = {
  label: "Active",
  className: "bg-emerald-400/10 text-emerald-400",
  title: "Match verified — ready to publish",
};

export default function StatusChip({ status, verified = false }: { status: ScanStatus; verified?: boolean }) {
  const { label, className, title } = status === "ready" && verified ? ACTIVE : STYLES[status];

  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        status === "scanning" ? "chip-working animate-pulse" : ""
      } ${className}`}
    >
      {status === "scanning" && <Spinner className="h-3 w-3" />}
      {((status === "ready" && verified) || status === "listed") && (
        <span
          className={`h-1.5 w-1.5 rounded-full ${status === "ready" ? "bg-emerald-400" : "bg-sky-400"}`}
        />
      )}
      {status === "sold" && <span aria-hidden>🎉</span>}
      {label}
    </span>
  );
}
