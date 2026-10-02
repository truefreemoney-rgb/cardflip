"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SealedProductAdd from "@/components/SealedProductAdd";
import { useBodyScrollLock } from "@/lib/client/useBodyScrollLock";
import { useBackToClose } from "@/lib/client/useBackToClose";
import { useFocusTrap } from "@/lib/client/useFocusTrap";
import type { SetInfo } from "@/lib/grading";
import type { GameId } from "@/lib/types";

/**
 * "Add a sealed product" sheet (Tier 2 #13, 09-27) — the photo-first sealed
 * road the 09-01 cleanup left open. eBay only accepts photos of the actual
 * item, so the seller's own photo of the box comes first and is required;
 * the set + kind picker below it names the product, and the TCGplayer
 * sealed feed (lib/server/sealedPrices.ts) prices it in the editor.
 */
export default function SealedAddSheet({
  game,
  onClose,
  onAdd,
}: {
  game: GameId;
  onClose: () => void;
  onAdd: (file: File, set: SetInfo, productType: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  useBodyScrollLock();
  useBackToClose("sealed-add", onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add a sealed product"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-up max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-edge bg-surface-1 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/60 outline-none sm:rounded-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold text-white">Add a sealed product</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Booster boxes, ETBs, tins and packs. Priced from the market where we have it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M5 5l10 10M15 5l-10 10" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Step 1: the photo. Required — it is the eBay listing image. */}
        <div className="mt-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">1 · Your photo of it</p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            data-testid="sealed-photo-input"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              if (f && f.type.startsWith("image/")) setFile(f);
              e.target.value = "";
            }}
          />
          {file ? (
            <div className="mt-2 flex items-center gap-3">
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-zinc-200">{file.name || "Photo"}</p>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="mt-1 text-xs text-zinc-400 underline decoration-zinc-600 underline-offset-2 hover:text-zinc-200"
                >
                  Use a different photo
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-2 flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-edge-strong bg-black/20 px-4 py-5 text-center transition hover:border-brand-400"
            >
              <span className="text-2xl" aria-hidden>📦</span>
              <span className="text-sm font-semibold text-white">Take or choose a photo of the box</span>
              <span className="text-xs text-zinc-500">eBay needs a photo of the actual item, not stock art</span>
            </button>
          )}
        </div>

        {/* Step 2: name it. */}
        <div className={`mt-5 ${file ? "" : "pointer-events-none opacity-40"}`} aria-disabled={!file}>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">2 · Which set, what is it</p>
          <SealedProductAdd
            key={game}
            game={game}
            onAdd={(set, type) => {
              if (!file) return;
              onAdd(file, set, type);
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
}
