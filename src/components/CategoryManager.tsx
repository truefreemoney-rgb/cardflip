"use client";

import { useEffect, useRef, useState } from "react";
import { useBodyScrollLock } from "@/lib/client/useBodyScrollLock";
import { useFocusTrap } from "@/lib/client/useFocusTrap";
import { CATEGORY_MAX } from "@/lib/categories";

/**
 * Category management sheet (Chris, 09-08: "I need some management options
 * for the folders" → "an add Category button, and call it categories").
 * One row per category with its card count: Rename (inline; typing an
 * existing name merges into it) and Delete (cards go to Uncategorized — the
 * cards themselves are never touched). "+ New category" at the bottom
 * creates an empty one, ready for scans. Same sheet shape as CategorySheet.
 */
export default function CategoryManager({
  categories,
  busy,
  onClose,
  onAdd,
  onRename,
  onDelete,
}: {
  categories: { name: string; count: number }[];
  /** The category currently being saved, if any ("" while adding). */
  busy: string | null;
  onClose: () => void;
  onAdd: (name: string) => Promise<boolean>;
  onRename: (from: string, to: string) => Promise<boolean>;
  onDelete: (name: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  useFocusTrap(panelRef);
  useBodyScrollLock();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (editing) setEditing(null);
      else if (adding) setAdding(false);
      else onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, editing, adding]);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);
  useEffect(() => {
    if (adding) newRef.current?.focus();
  }, [adding]);

  const trimmed = draft.trim().slice(0, CATEGORY_MAX);
  const mergeInto =
    editing && trimmed && trimmed.toLowerCase() !== editing.toLowerCase()
      ? categories.find((c) => c.name.toLowerCase() === trimmed.toLowerCase()) ?? null
      : null;
  const newTrimmed = newName.trim().slice(0, CATEGORY_MAX);
  const newDup = newTrimmed ? categories.find((c) => c.name.toLowerCase() === newTrimmed.toLowerCase()) ?? null : null;
  const quiet =
    "inline-flex h-9 items-center justify-center rounded-full border border-edge px-3 text-xs font-medium text-zinc-300 transition hover:border-edge-strong hover:text-white disabled:opacity-50";
  const primary =
    "inline-flex h-9 items-center rounded-full bg-brand-500 px-3.5 text-xs font-semibold text-white transition hover:bg-brand-400 disabled:opacity-50";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Manage categories"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-up max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-edge bg-surface-1 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/60 outline-none sm:rounded-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold text-white">Manage categories</p>
            <p className="mt-0.5 text-xs text-zinc-500">Add, rename or delete. Deleting one sends its cards back to Uncategorized.</p>
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

        <ul className="mt-4 divide-y divide-white/5 overflow-hidden rounded-xl border border-edge">
          {categories.length === 0 && !adding && (
            <li className="px-4 py-6 text-center text-sm text-zinc-500">No categories yet.</li>
          )}
          {categories.map((c) => {
            const isBusy = busy === c.name;
            if (editing === c.name) {
              return (
                <li key={c.name} className="bg-black/20 px-3 py-3">
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!trimmed || trimmed === c.name) {
                        setEditing(null);
                        return;
                      }
                      if (await onRename(c.name, trimmed)) setEditing(null);
                    }}
                    className="flex items-center gap-2"
                  >
                    <input
                      ref={inputRef}
                      type="text"
                      value={draft}
                      maxLength={CATEGORY_MAX}
                      onChange={(e) => setDraft(e.target.value)}
                      aria-label={`New name for ${c.name}`}
                      className="min-w-0 flex-1 rounded-xl border border-edge bg-black/30 px-3.5 py-2 text-base text-white outline-none focus:border-brand-400 sm:text-sm"
                    />
                    <button type="submit" disabled={isBusy || !trimmed} className={primary}>
                      {isBusy ? "Saving…" : mergeInto ? "Merge" : "Save"}
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className={quiet}>
                      Cancel
                    </button>
                  </form>
                  {mergeInto && (
                    <p className="mt-1.5 text-xs text-amber-300">
                      &ldquo;{mergeInto.name}&rdquo; already exists — these {c.count} card{c.count === 1 ? "" : "s"} will move into it.
                    </p>
                  )}
                </li>
              );
            }
            return (
              <li key={c.name} className="flex items-center gap-3 px-3 py-2.5">
                <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
                  <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h3.4l1.6 1.6h6A1.5 1.5 0 0 1 17 8.1v6.4a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5v-8Z" />
                </svg>
                <span className="min-w-0 flex-1 truncate text-sm text-white">
                  {c.name} <span className="text-xs text-zinc-500">· {c.count}</span>
                </span>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    setDraft(c.name);
                    setEditing(c.name);
                  }}
                  className={quiet}
                >
                  Rename
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void onDelete(c.name)}
                  className={`${quiet} border-red-400/25 text-red-300/80 hover:border-red-400/60 hover:bg-red-400/10 hover:text-red-200`}
                >
                  {isBusy ? "…" : "Delete"}
                </button>
              </li>
            );
          })}
          {adding && (
            <li className="bg-black/20 px-3 py-3">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newTrimmed || newDup) return;
                  if (await onAdd(newTrimmed)) {
                    setNewName("");
                    setAdding(false);
                  }
                }}
                className="flex items-center gap-2"
              >
                <input
                  ref={newRef}
                  type="text"
                  value={newName}
                  maxLength={CATEGORY_MAX}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Binder 1, For sale, Kids' deck"
                  aria-label="New category name"
                  className="min-w-0 flex-1 rounded-xl border border-edge bg-black/30 px-3.5 py-2 text-base text-white outline-none placeholder:text-zinc-600 focus:border-brand-400 sm:text-sm"
                />
                <button type="submit" disabled={busy === "" || !newTrimmed || Boolean(newDup)} className={primary}>
                  {busy === "" ? "Adding…" : "Add"}
                </button>
                <button type="button" onClick={() => setAdding(false)} className={quiet}>
                  Cancel
                </button>
              </form>
              {newDup && <p className="mt-1.5 text-xs text-amber-300">&ldquo;{newDup.name}&rdquo; already exists.</p>}
            </li>
          )}
        </ul>

        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-dashed border-edge-strong px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-brand-400 hover:text-white"
          >
            + New category
          </button>
        )}
      </div>
    </div>
  );
}
