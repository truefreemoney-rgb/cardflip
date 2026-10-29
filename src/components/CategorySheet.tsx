"use client";

import { useEffect, useRef, useState } from "react";
import Sheet from "@/components/Sheet";

import { AUTO_CATEGORY, CATEGORY_MAX } from "@/lib/categories";
export { CATEGORY_MAX };

/**
 * "Which category?" bottom sheet (Chris, 09-04: organise Inventory into
 * categories — pick one before a scan, or move selected cards into one).
 * Existing categories are one-tap chips; "New category" is a text field.
 * "No category" leaves the card uncategorized. Shared by the scanner
 * (pre-scan prompt) and Inventory (bulk move).
 * "Auto" (10-29, Chris) files each card under its own set (lib/categories.ts
 * setCategoryFor): the scanner's sheet shows it in place of "No category",
 * Inventory's move sheets show both.
 */
export default function CategorySheet({
  title,
  hint,
  categories,
  current,
  confirmLabel = "Continue",
  busy = false,
  auto,
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
  /** "replace": Auto stands where "No category" was (the scanner); "add": both (Inventory's moves). */
  auto?: "replace" | "add";
  onClose: () => void;
  /** null = no category; AUTO_CATEGORY = each card's own set. */
  onPick: (category: string | null) => void;
}) {
  // Auto is the default when nothing is remembered and the sheet offers it (10-29).
  const [choice, setChoice] = useState<string | null>(current ?? (auto === "replace" ? AUTO_CATEGORY : null));
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
    // before: = 6px above and below: the 34px chip taps at 46px, inside the gap-2 between rows (review 10-19 #24).
    `relative inline-flex max-w-full items-center rounded-full border px-3 py-1.5 text-sm font-medium transition before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] ${
      active
        ? "border-brand-400 bg-brand-500/15 text-white"
        : "border-edge text-zinc-300 hover:border-edge-strong hover:text-white"
    }`;

  return (
    <Sheet title={title} hint={hint} onClose={onClose} backId="category">
        <div className="flex flex-wrap gap-2">
          {auto && (
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setChoice(AUTO_CATEGORY);
              }}
              className={chip(!creating && choice === AUTO_CATEGORY)}
              title="Each card goes in a category named after its set"
            >
              Auto · by set
            </button>
          )}
          {auto !== "replace" && (
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
          )}
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

        {/* One centered button; the X closes (Chris 10-12: "take out the cancel button"). */}
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => onPick(result)}
            className="inline-flex w-full max-w-[16rem] items-center justify-center rounded-full bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
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
    if (c.category && c.category !== AUTO_CATEGORY && !seen.has(c.category.toLowerCase())) seen.set(c.category.toLowerCase(), c.category);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
