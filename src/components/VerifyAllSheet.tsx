"use client";

import { useEffect, useRef } from "react";
import CardImage from "@/components/CardImage";
import { normalizeNumber } from "@/lib/cardNumber";
import { useFocusTrap } from "@/lib/client/useFocusTrap";
import { formatMoney, headlinePrice } from "@/lib/listing";
import type { ScanItem } from "@/lib/types";

/** A read at or above this, with the printed number matching the pick, is safe to confirm in bulk. */
const SURE = 0.85;

/**
 * One tap confirms only the clear ones: Ready, no doubt flagged, the vision
 * read at least 85% sure, and the number it read off the photo is the number
 * of the card picked (the same "pinned" test the scanner uses). Everything
 * else stays for a look.
 */
export function canConfirmInBulk(item: ScanItem): boolean {
  const card = item.card;
  const read = item.vision;
  if (!card || !read || item.verifiedAt || item.matchDoubt || item.status !== "ready" || item.printingsCheck) return false;
  if (typeof read.confidence !== "number" || read.confidence < SURE) return false;
  return Boolean(read.cardNumber) && normalizeNumber(card.number) === normalizeNumber(read.cardNumber ?? "");
}

function Row({ item, onOpen, onRemove }: { item: ScanItem; onOpen?: (id: string) => void; onRemove?: (id: string) => void }) {
  const card = item.card!;
  const market = headlinePrice(item);
  return (
    <li className="flex items-center gap-2 rounded-xl border border-edge bg-surface-2 p-2">
      <div className="flex shrink-0 gap-1" aria-hidden>
        <div className="h-14 w-10 overflow-hidden rounded-md bg-black/40">
          {item.previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="h-14 w-10 overflow-hidden rounded-md bg-black/40">
          {card.imageSmall && <CardImage src={card.imageSmall} alt="" className="h-full w-full" />}
        </div>
      </div>
      <button type="button" onClick={onOpen ? () => onOpen(item.id) : undefined} className="min-w-0 flex-1 text-left" aria-label={`Open ${card.name}`}>
        <span className="block truncate text-sm font-semibold text-white">{card.name}</span>
        <span className="block truncate text-xs text-zinc-400">
          {card.setName}
          {card.number ? ` · #${card.number}` : ""}
        </span>
        {item.matchDoubt && <span className="block truncate text-xs text-amber-300">{item.matchDoubt}</span>}
      </button>
      <p className="shrink-0 font-display text-sm font-semibold tabular-nums text-emerald-300">{market > 0 ? formatMoney(market) : "—"}</p>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          aria-label={`Remove ${card.name}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white"
        >
          ×
        </button>
      )}
    </li>
  );
}

/**
 * "Verify all" after a stack scan: your photo beside the catalog art for
 * every scan waiting. Doubtful ones come first, apart, and are never
 * auto-confirmed; one button confirms the clear ones.
 */
export default function VerifyAllSheet({
  items,
  total,
  onConfirm,
  onOpen,
  onRemove,
  onClose,
  onReview,
}: {
  items: ScanItem[];
  total: number;
  onConfirm: (ids: string[]) => void;
  onOpen?: (id: string) => void;
  onRemove?: (id: string) => void;
  onClose: () => void;
  /** Leave for the queue to go through the rest one by one. */
  onReview: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const withCard = items.filter((i) => i.card);
  const verified = withCard.filter((i) => i.verifiedAt);
  const open = withCard.filter((i) => !i.verifiedAt);
  const sure = open.filter(canConfirmInBulk);
  const check = open.filter((i) => !canConfirmInBulk(i)).sort((a, b) => Number(Boolean(b.matchDoubt)) - Number(Boolean(a.matchDoubt)));

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/90 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Scans waiting to verify"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="panel-solid animate-fade-up flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-2xl border p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/60 outline-none sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-lg font-semibold text-white">Scans waiting to verify</p>
            <p className="mt-0.5 text-sm text-zinc-400 tabular-nums">
              {withCard.length} {withCard.length === 1 ? "scan" : "scans"}
              {total > 0 ? ` · ${formatMoney(total)}` : ""}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">Left: your photo. Right: the card we matched.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white">
            ×
          </button>
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {check.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-amber-300">Check these first ({check.length})</p>
              <ul className="flex flex-col gap-2">
                {check.map((item) => (
                  <Row key={item.id} item={item} onOpen={onOpen} onRemove={onRemove} />
                ))}
              </ul>
            </section>
          )}
          {sure.length > 0 && (
            <section className={check.length > 0 ? "mt-4" : ""}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-emerald-400">Looks right ({sure.length})</p>
              <ul className="flex flex-col gap-2">
                {sure.map((item) => (
                  <Row key={item.id} item={item} onOpen={onOpen} onRemove={onRemove} />
                ))}
              </ul>
            </section>
          )}
          {verified.length > 0 && <p className="mt-4 text-center text-xs text-zinc-500">{verified.length} already verified</p>}
        </div>
        {sure.length > 0 && (
          <button
            type="button"
            onClick={() => onConfirm(sure.map((i) => i.id))}
            className="mt-4 w-full shrink-0 rounded-full bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400"
          >
            {sure.length === open.length ? `Confirm all ${sure.length}` : `Confirm ${sure.length} that look right`}
          </button>
        )}
        <button
          type="button"
          onClick={onReview}
          className={`w-full shrink-0 rounded-full px-4 py-3 text-sm font-semibold transition ${
            sure.length > 0 ? "mt-2 border border-edge text-zinc-200 hover:border-edge-strong" : "mt-4 bg-emerald-500 text-white hover:bg-emerald-400"
          }`}
        >
          {check.length > 0 ? `Check ${check.length === 1 ? "it" : "them"} one by one` : "Done"}
        </button>
      </div>
    </div>
  );
}
