"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchCardById } from "@/lib/cards";
import { fetchCurrentUser } from "@/lib/client/auth";
import { addToWishlist } from "@/lib/client/wishlistApi";
import { apiFetch } from "@/lib/client/basePath";
import { pickPrice } from "@/lib/listing";
import { toast } from "@/components/Toaster";
import type { GameId } from "@/lib/types";

/**
 * "Watch this price" on a public card page (QoL 10-06). Signed in: the card is
 * added to the watchlist through the same /api/wishlist the app uses (the full
 * card is fetched by catalog id first, like the watchlist's own reopen path).
 * Signed out: the card is parked in this browser (localStorage) and the visitor
 * goes to /signup; <PendingWatch /> (mounted in the app layout) adds it on the
 * first signed-in page. Not an "add to collection": the watchlist only.
 */

const KEY = "cardflip.pendingWatch";
const MAX_AGE_MS = 7 * 86_400_000;

async function addById(game: GameId, id: string): Promise<boolean> {
  const card = await fetchCardById(id, game).catch(() => null);
  if (!card) return false;
  return (await addToWishlist(card, "en", pickPrice(card)?.market ?? null)) !== null;
}

export default function WatchPrice({ game, id, className = "" }: { game: GameId; id: string; className?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  const click = async () => {
    setState("busy");
    try {
      const user = await fetchCurrentUser();
      if (!user) {
        try {
          window.localStorage.setItem(KEY, JSON.stringify({ game, id, at: Date.now() }));
        } catch {
          // Private mode: the visitor still signs up, they just add the card by hand.
        }
        router.push(`/signup?watch=${encodeURIComponent(`${game}:${id}`)}`);
        return;
      }
      setState((await addById(game, id)) ? "done" : "error");
    } catch {
      setState("error");
    }
  };

  if (state === "done") {
    return (
      <p className={`rounded-full border border-emerald-400/30 bg-emerald-400/10 px-5 py-3 text-center text-sm text-emerald-200 ${className}`} role="status">
        Watching.{" "}
        <Link href="/app/wishlist" className="font-semibold underline underline-offset-2">
          See your watchlist
        </Link>
      </p>
    );
  }
  return (
    <span className={`inline-flex flex-col ${className}`}>
      <button
        type="button"
        onClick={click}
        disabled={state === "busy"}
        className="rounded-full border border-edge-strong bg-surface-2 px-6 py-3 text-center text-sm font-semibold text-white transition hover:border-brand-400 disabled:opacity-60"
      >
        {state === "busy" ? "Adding..." : "Watch this price"}
      </button>
      {state === "error" && (
        <span className="mt-1.5 text-center text-xs text-amber-300" role="alert">
          Could not add it. Try again.
        </span>
      )}
    </span>
  );
}

type Pending = { game: GameId; id: string; at: number };

/** The watch parked in this browser, or null (missing, malformed, older than a week). */
function readLocalPending(): Pending | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let pending: Partial<Pending> | null = null;
  try {
    pending = JSON.parse(raw);
  } catch {
    pending = null;
  }
  if (!pending?.game || !pending.id || !pending.at || Date.now() - pending.at > MAX_AGE_MS) {
    dropLocalPending();
    return null;
  }
  return pending as Pending;
}

function dropLocalPending(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // nothing to do
  }
}

/**
 * Park the browser's pending watch on the server (10-08): the confirm screen
 * calls this right after signup, so the watch follows the person from a
 * private tab or TikTok's browser into whichever browser opens the confirm
 * link (localStorage does not travel; Chris, 10-08). Needs the session the
 * fresh account already has. Never throws; nothing to do without a watch.
 */
export async function pushPendingWatch(): Promise<void> {
  const pending = readLocalPending();
  if (!pending) return;
  try {
    await apiFetch("/api/watch/pending", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ game: pending.game, id: pending.id }),
    });
  } catch {
    // The local copy still stands for this browser.
  }
}

async function fetchServerPending(): Promise<Pending | null> {
  try {
    const res = await apiFetch("/api/watch/pending");
    if (!res.ok) return null;
    const data = (await res.json()) as { pending?: Pending | null };
    return data.pending?.game && data.pending.id ? data.pending : null;
  } catch {
    return null;
  }
}

async function dropServerPending(): Promise<void> {
  try {
    await apiFetch("/api/watch/pending", { method: "DELETE" });
  } catch {
    // Left behind, it is finished on the next signed-in page.
  }
}

/** Mount once inside the signed-in app: finishes a "Watch this price" started while signed out. */
export function PendingWatch() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = readLocalPending();
      const user = await fetchCurrentUser().catch(() => null);
      if (!user || cancelled) return; // still signed out: the local copy waits for after signup
      // This browser's copy first; the server's when the signup happened elsewhere.
      const pending = local ?? (await fetchServerPending());
      if (!pending || cancelled) return;
      dropLocalPending();
      void dropServerPending();
      toast((await addById(pending.game, pending.id)) ? "Added to your watchlist" : "Could not add that card to your watchlist", "info");
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
