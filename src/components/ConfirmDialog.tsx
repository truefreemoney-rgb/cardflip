"use client";

import { useEffect, useState } from "react";
import Sheet from "@/components/Sheet";

/**
 * In-app replacement for window.confirm. iOS suppresses native confirm()
 * dialogs in installed (standalone) PWAs — it returns false with no dialog,
 * so every confirm-gated action silently does nothing (09-02: bulk delete on
 * Chris's phone). Same promise shape as confirm, so call sites read the same:
 * `if (!(await confirmAction({ message }))) return;`
 *
 * <ConfirmHost /> renders the dialog; it's mounted in Toaster (all /app
 * pages) and in EbayConnectCard (used on /connect-ebay and signup, outside
 * the app shell). A module-level flag keeps a second mount inert so those
 * never double-render.
 */

export interface ConfirmOptions {
  message: string;
  /** Label on the confirming button, e.g. "Delete 5 cards". Default "Confirm". */
  confirmLabel?: string;
  /** Red confirm button for destructive actions. Default true. */
  danger?: boolean;
}

const EVENT = "cardflip:confirm";

interface ConfirmRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent<ConfirmRequest>(EVENT, { detail: { ...opts, resolve } }));
  });
}

let hostMounted = false;

export default function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    // Only one host listens; a second mount stays inert (its req is never
    // set, so it renders nothing) — that alone prevents double dialogs.
    if (hostMounted) return;
    hostMounted = true;
    const onConfirm = (e: Event) => setReq((e as CustomEvent<ConfirmRequest>).detail);
    window.addEventListener(EVENT, onConfirm);
    return () => {
      window.removeEventListener(EVENT, onConfirm);
      hostMounted = false;
    };
  }, []);

  if (!req) return null;

  const answer = (ok: boolean) => {
    req.resolve(ok);
    setReq(null);
  };

  return (
    <Sheet
      role="alertdialog"
      label="Confirm"
      maxWidth="max-w-sm"
      onClose={() => answer(false)}
      footer={
        <div className="flex justify-end gap-2">
          <button
            autoFocus
            onClick={() => answer(false)}
            className="rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-edge-strong hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={() => answer(true)}
            className={
              req.danger === false
                ? "rounded-full bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition"
                : "rounded-full border border-red-400/40 bg-red-500/15 px-4 py-2.5 text-sm font-semibold text-red-200 transition hover:bg-red-500/25"
            }
          >
            {req.confirmLabel ?? "Confirm"}
          </button>
        </div>
      }
    >
      <p className="pr-8 text-sm leading-relaxed text-zinc-200">{req.message}</p>
    </Sheet>
  );
}
