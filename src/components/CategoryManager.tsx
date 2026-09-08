"use client";

import { useEffect, useRef, useState } from "react";
import { useBodyScrollLock } from "@/lib/client/useBodyScrollLock";
import { useFocusTrap } from "@/lib/client/useFocusTrap";
import { CATEGORY_MAX } from "@/lib/categories";

/**
 * Folder management sheet (Chris, 09-08: "I need some management options
 * for the folders"). One row per folder with its card count: Rename (inline;
 * typing an existing name merges into it) and Delete (cards go to
 * Uncategorized — the cards themselves are never touched). Same sheet
 * shape as CategorySheet.
 */
export default function CategoryManager({
  folders,
  busy,
  onClose,
  onRename,
  onDelete,
}: {
  folders: { name: string; count: number }[];
  /** The folder currently being saved, if any. */
  busy: string | null;
  onClose: () => void;
  onRename: (from: string, to: string) => Promise<boolean>;
  onDelete: (name: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useFocusTrap(panelRef);
  useBodyScrollLock();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (editing) setEditing(null);
      else onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, editing]);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const trimmed = draft.trim().slice(0, CATEGORY_MAX);
  const mergeInto = editing && trimmed && trimmed.toLowerCase() !== editing.toLowerCase()
    ? folders.find((f) => f.name.toLowerCase() === trimmed.toLowerCase()) ?? null
    : null;
  const quiet =
    "inline-flex h-9 items-center justify-center rounded-full border border-edge px-3 text-xs font-medium text-zinc-300 transition hover:border-edge-strong hover:text-white disabled:opacity-50";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Manage folders"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-up max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-edge bg-surface-1 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/60 outline-none sm:rounded-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold text-white">Manage folders</p>
            <p className="mt-0.5 text-xs text-zinc-500">Rename a folder, or delete one — its cards just go back to Uncategorized.</p>
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
          {folders.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-zinc-500">No folders yet — add one from a card&apos;s Category.</li>
          )}
          {folders.map((f) => {
            const isBusy = busy === f.name;
            if (editing === f.name) {
              return (
                <li key={f.name} className="bg-black/20 px-3 py-3">
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!trimmed || trimmed === f.name) {
                        setEditing(null);
                        return;
                      }
                      if (await onRename(f.name, trimmed)) setEditing(null);
                    }}
                    className="flex items-center gap-2"
                  >
                    <input
                      ref={inputRef}
                      type="text"
                      value={draft}
                      maxLength={CATEGORY_MAX}
                      onChange={(e) => setDraft(e.target.value)}
                      aria-label={`New name for ${f.name}`}
                      className="min-w-0 flex-1 rounded-xl border border-edge bg-black/30 px-3.5 py-2 text-base text-white outline-none focus:border-brand-400 sm:text-sm"
                    />
                    <button type="submit" disabled={isBusy || !trimmed} className="inline-flex h-9 items-center rounded-full bg-brand-500 px-3.5 text-xs font-semibold text-white transition hover:bg-brand-400 disabled:opacity-50">
                      {isBusy ? "Saving…" : mergeInto ? "Merge" : "Save"}
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className={quiet}>
                      Cancel
                    </button>
                  </form>
                  {mergeInto && (
                    <p className="mt-1.5 text-xs text-amber-300">
                      &ldquo;{mergeInto.name}&rdquo; already exists — these {f.count} card{f.count === 1 ? "" : "s"} will move into it.
                    </p>
                  )}
                </li>
              );
            }
            return (
              <li key={f.name} className="flex items-center gap-3 px-3 py-2.5">
                <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
                  <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h3.4l1.6 1.6h6A1.5 1.5 0 0 1 17 8.1v6.4a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5v-8Z" />
                </svg>
                <span className="min-w-0 flex-1 truncate text-sm text-white">
                  {f.name} <span className="text-xs text-zinc-500">· {f.count}</span>
                </span>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    setDraft(f.name);
                    setEditing(f.name);
                  }}
                  className={quiet}
                >
                  Rename
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void onDelete(f.name)}
                  className={`${quiet} border-red-400/25 text-red-300/80 hover:border-red-400/60 hover:bg-red-400/10 hover:text-red-200`}
                >
                  {isBusy ? "…" : "Delete"}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
