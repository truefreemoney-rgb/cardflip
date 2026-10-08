"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PlanCard from "@/components/PlanCard";
import PlanCta from "@/components/PlanCta";
import PlanPrice from "@/components/PlanPrice";
import { useSession } from "@/components/SessionProvider";
import { logout } from "@/lib/client/auth";
import { openBillingPortal } from "@/lib/client/accountApi";
import { fetchServerCards } from "@/lib/client/cardsApi";
import { ROLLOVER_SENTENCE, SCANS } from "@/lib/pricing";

/**
 * What a signed-in seller without an active subscription sees on every app
 * page (paid-only from 09-04). Chris, 10-01: "it should look more like our
 * pricing page", so the wall is the pricing page's own plan cards (CardFlip,
 * Pro, the Booster strip) without the free card, each button opening its
 * checkout directly. A lapsed subscriber also gets the billing portal as a
 * text link so a failed card is one tap to fix. Admins never land here
 * (SubscriptionGate lets them through).
 */
export default function Paywall() {
  const router = useRouter();
  const { user, refresh } = useSession();
  const [busy, setBusy] = useState<"portal" | "refresh" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "Ended" only when Stripe says the plan is gone. A trial override on a
  // subscribed account is still a trial, so it gets the trial copy.
  const lapsed = Boolean(user?.subStatus) && user?.tier !== "trial";
  // Plan scans banked before the plan ended: paused, not lost (they come back on resubscribe).
  const paused = user?.scans?.frozen ?? 0;
  // Quick-buy box (10-07, first ad signup hit this wall): their card count up top, and
  // both buy buttons on the first phone screen instead of 1-3 screens down.
  const [cardCount, setCardCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchServerCards().then((cards) => {
      if (alive && cards) setCardCount(cards.length);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function openPortal() {
    setBusy("portal");
    setError(null);
    try {
      window.location.assign(await openBillingPortal());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setBusy(null);
    }
  }

  const quiet =
    "text-sm text-zinc-500 underline-offset-4 transition hover:text-zinc-300 hover:underline disabled:opacity-60";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand-400">
          {lapsed ? "Welcome Back" : "Keep Scanning"}
        </p>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-5xl">
          {lapsed ? "Your subscription ended." : "You're out of scans."}
        </h1>
        <p className="mt-3 text-base text-zinc-400 sm:text-lg">
          {lapsed
            ? "Everything is still here. Pick a plan to pick it back up."
            : "Everything you scanned is still here. Pick a plan to keep going."}
        </p>
      </div>

      {paused > 0 && (
        <p role="status" className="mt-5 w-full max-w-md rounded-lg bg-emerald-400/10 px-3 py-2 text-center text-sm text-emerald-200">
          Your {paused.toLocaleString("en-US")} banked {paused === 1 ? "scan is" : "scans are"} paused. {paused === 1 ? "It comes" : "They come"} back when you resubscribe.
        </p>
      )}

      <div className="mt-5 w-full max-w-md rounded-2xl border border-edge bg-surface-1 p-4">
        {cardCount != null && cardCount > 0 && (
          <p className="mb-3 text-center font-semibold text-white">
            Your {cardCount.toLocaleString("en-US")} {cardCount === 1 ? "card is" : "cards are"} saved in Inventory.
          </p>
        )}
        <div className="flex flex-col gap-2">
          <PlanCta
            tight
            plan="pack"
            primary
            sessionUser={user ?? undefined}
            cta={<>Buy {SCANS.pack} Scans · <PlanPrice plan="pack" /></>}
          />
          <PlanCta
            tight
            plan="standard"
            primary={false}
            sessionUser={user ?? undefined}
            cta={<>Subscribe · <PlanPrice plan="standard" />/mo</>}
          />
        </div>
        <p className="mt-2 text-center text-xs text-zinc-500">Booster: pay once, scans never expire.</p>
      </div>

      <PlanCard trial={false} sessionUser={user ?? undefined} className="mt-6 w-full text-left" />

      <p className="mt-4 text-center text-xs text-zinc-500">{ROLLOVER_SENTENCE} Cancel any time.</p>

      {error && (
        <p role="alert" className="mt-4 w-full max-w-md rounded-lg bg-red-500/10 px-3 py-2 text-center text-sm text-red-300">
          {error}
        </p>
      )}

      {lapsed && (
        <button type="button" onClick={() => void openPortal()} disabled={busy !== null} className={`mt-4 ${quiet}`}>
          {busy === "portal" ? "Opening…" : "Fix a Failed Card"}
        </button>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-zinc-600">
        <button
          type="button"
          onClick={async () => {
            setBusy("refresh");
            try {
              await refresh();
            } finally {
              setBusy(null);
            }
          }}
          disabled={busy !== null}
          className="transition hover:text-zinc-300 disabled:opacity-60"
        >
          {busy === "refresh" ? "Checking…" : "Just subscribed? Refresh"}
        </button>
        <Link href="/app/account" className="transition hover:text-zinc-300">
          Account
        </Link>
        <button
          type="button"
          onClick={() => void logout().then(() => router.replace("/login"))}
          className="transition hover:text-zinc-300"
        >
          Log out
        </button>
      </div>
    </main>
  );
}
