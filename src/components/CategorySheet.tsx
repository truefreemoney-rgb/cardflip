"use client";

import { useEffect, useRef, useState } from "react";
import Sheet from "@/components/Sheet";

import { CATEGORY_MAX } from "@/lib/categories";
export { CATEGORY_MAX };

/**
 * "Which category?" bottom sheet (Chris, 09-04: organise Inventory into
 * categories — pick one before a scan, or move selected cards into one).
 * Existing categories are one-tap chips; "New category" is a text field.
 * "No category" leaves the card uncategorized. Shared by the scanner
 * (pre-scan prompt) and Inventory (bulk move).
 */
export default function CategorySheet({
  title,
  hint,
  categories,
  current,
  confirmLabel = "Continue",
  busy = false,
  onClose,
  onPick,
}: {
  title: string;
  hint?: string;
  /** Existing category names, already de-duplicated. */
  categories: string[];
  /** The pre-selected choice; null = uncategorized. */
  current: string | null;
  confirmLabel?: string;
  busy?: boolean;
  onClose: () => void;
  /** null = no category. */
  onPick: (category: string | null) => void;
}) {
  const [choice, setChoice] = useState<string | null>(current);
  // Never start in "new" mode: on an iPhone the autofocused field raised
  // the keyboard over the sheet before the seller saw it (Chris, 09-04).
  const [creating, setCreating] = useState(false);
  const [touched, setTouched] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Sheet owns Escape (capture phase, so it closes alone over the card detail
  // modal), Back, the ref-counted scroll lock and riding up over the iOS keyboard.
  useEffect(() => {
    if (creating && touched) inputRef.current?.focus();
  }, [creating, touched]);
  const trimmed = draft.trim().slice(0, CATEGORY_MAX);
  const dup = trimmed && categories.some((c) => c.toLowerCase() === trimmed.toLowerCase());
  const result = creating ? (trimmed || null) : choice;
  const canConfirm = !busy && (!creating || Boolean(trimmed));

  const chip = (active: boolean) =>
    `inline-flex max-w-full items-center rounded-full border px-3 py-1.5 text-sm font-medium transition ${
      active
        ? "border-brand-400 bg-brand-500/15 text-white"
        : "border-edge text-zinc-300 hover:border-edge-strong hover:text-white"
    }`;

  return (
    <Sheet title={title} hint={hint} onClose={onClose} backId="category">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setChoice(null);
            }}
            className={chip(!creating && choice === null)}
          >
            No category
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setCreating(false);
                setChoice(c);
              }}
              className={chip(!creating && choice === c)}
            >
              <span className="truncate">{c}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setTouched(true);
              setCreating(true);
            }}
            className={chip(creating)}
          >
            + New category
          </button>
        </div>

        {creating && (
          <div className="mt-3">
            <input
              ref={inputRef}
              type="text"
              value={draft}
              maxLength={CATEGORY_MAX}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canConfirm) onPick(result);
              }}
              placeholder="e.g. Binder 1, For sale, Kids' deck"
              className="w-full rounded-xl border border-edge bg-black/30 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-brand-400"
            />
            {dup && <p className="mt-1.5 text-xs text-amber-300">That category already exists — it&apos;ll be reused.</p>}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex flex-1 items-center justify-center rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-edge-strong hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => onPick(result)}
            className="inline-flex flex-1 items-center justify-center rounded-full bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
    </Sheet>
  );
}

/** Distinct category names from a card list, A→Z, case-insensitive. */
export function distinctCategories(cards: { category: string | null }[]): string[] {
  const seen = new Map<string, string>();
  for (const c of cards) {
    if (c.category && !seen.has(c.category.toLowerCase())) seen.set(c.category.toLowerCase(), c.category);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
