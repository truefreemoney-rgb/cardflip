"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import Spinner from "@/components/Spinner";
import { fetchAccount } from "@/lib/client/accountApi";

/**
 * Where Stripe Checkout lands a new subscriber (Chris, 09-25: dropping them
 * on the Profile page "can be a lot better"). One screen, one job: you're
 * in, here is the scanner. eBay is the second button because selling just
 * unlocked; billing is a small link because nobody needs it right now.
 *
 * Lives under /app/account so SubscriptionGate lets it through while the
 * webhook is still flipping subStatus — the same race the account page
 * handles, polled the same way.
 */
export default function SubscribedPage() {
  const { user, refresh } = useSession();
  const [phase, setPhase] = useState<"waiting" | "confirmed" | "stalled">("waiting");

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const check = async () => {
      tries += 1;
      const o = await fetchAccount();
      if (cancelled) return true;
      if (o && (o.user.subStatus === "active" || o.user.subStatus === "trialing")) {
        setPhase("confirmed");
        void refresh();
        return true;
      }
      // ~30s of patience; past that the plan still flips on the next visit.
      if (tries >= 15) {
        setPhase("stalled");
        return true;
      }
      return false;
    };
    void check().then((done) => {
      if (done) return;
      const id = setInterval(async () => {
        if (await check()) clearInterval(id);
      }, 2000);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const first = user?.name?.split(" ")[0];
  const scans = user?.plan === "pro" ? "2,000" : "500";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="foil-edge animate-fade-up relative w-full rounded-2xl p-8 text-center shadow-xl shadow-black/40 [--foil-fill:#0b0d13]">
        <div
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-2xl text-emerald-400"
          aria-hidden
        >
          {phase === "waiting" ? <Spinner className="h-6 w-6" /> : "✓"}
        </div>

        <h1 className="mt-5 text-xl font-semibold text-white">
          {phase === "waiting"
            ? "Confirming your subscription…"
            : `You're all set${first ? `, ${first}` : ""}`}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400" role="status">
          {phase === "stalled"
            ? "Payment received. Stripe is taking a moment to confirm — your plan will show as active shortly."
            : `${scans} scans a month, unlocked. Point the camera at a card and CardFlip names it, prices it, and drafts the eBay listing.`}
        </p>

        <Link
          href="/app"
          className="mt-7 flex w-full items-center justify-center rounded-full bg-brand-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-400"
        >
          Scan a card
        </Link>
        <Link
          href="/connect-ebay"
          className="mt-3 flex w-full items-center justify-center rounded-full border border-edge px-5 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-surface-2"
        >
          Connect eBay to sell
        </Link>

        <p className="mt-5 text-xs text-zinc-500">
          A receipt is in your inbox.{" "}
          <Link href="/app/account" className="font-medium text-brand-300 transition hover:text-brand-200">
            Manage billing
          </Link>
        </p>
      </div>
    </main>
  );
}
