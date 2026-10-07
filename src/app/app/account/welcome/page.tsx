"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import Spinner from "@/components/Spinner";
import { fetchAccount } from "@/lib/client/accountApi";
import { ROLLOVER_SENTENCE, SCANS } from "@/lib/pricing";
import { paymentCredited } from "@/lib/scanCopy";
import { pixelTrack } from "@/lib/client/pixel";

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
  // Scans the seller can spend, as the server counted them when the page confirmed.
  const [ready, setReady] = useState<number | null>(null);
  // ?billing=pack = a one-time Booster just paid (09-25); anything else is
  // a new subscription. Read before the URL is cleaned below.
  const [kind] = useState<"sub" | "pack">(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("billing") === "pack" ? "pack" : "sub",
  );

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  // A plan credit written after this moment is the payment that brought them here
  // (ten minutes of slack for a slow checkout; a credit older than that is a past month's).
  const [since] = useState(() => Date.now() - 10 * 60_000);

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const check = async () => {
      tries += 1;
      const o = await fetchAccount();
      if (cancelled) return true;
      // A subscription is confirmed only once the payment's scans are credited:
      // the status flips first, and "250 scans, unlocked" over a 0 balance (a red
      // header, a 402 on the first scan) reads as broken.
      const ok =
        kind === "pack"
          ? (o?.user.packScans ?? 0) > 0
          : (o?.user.subStatus === "active" || o?.user.subStatus === "trialing") && paymentCredited(o?.quota ?? o?.user.scans, since);
      if (o && ok) {
        setReady((o.quota ?? o.user.scans)?.remaining ?? null);
        setPhase("confirmed");
        pixelTrack(kind === "pack" ? "CompletePayment" : "Subscribe");
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
  }, [refresh, kind, since]);

  const first = user?.name?.split(" ")[0];
  // The server's own count, once the payment is credited; no count while waiting (or for an unlimited account).
  const scansReady = ready !== null && phase === "confirmed" ? `${ready.toLocaleString("en-US")} scans ready. ` : "";

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
            ? kind === "pack" ? "Confirming your Booster…" : "Confirming your subscription…"
            : `You're all set${first ? `, ${first}` : ""}`}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400" role="status">
          {phase === "stalled"
            ? `Payment received. Stripe is taking a moment to confirm — your ${kind === "pack" ? "scans will show up" : "plan and scans will show up"} shortly.`
            : kind === "pack"
              ? `${SCANS.pack} scans added, they never expire. Point the camera at a card and CardFlip names it, prices it, and drafts the eBay listing.`
              : `${scansReady}${ROLLOVER_SENTENCE} Point the camera at a card and CardFlip names it, prices it, and drafts the eBay listing.`}
        </p>

        <Link
          href="/app"
          className="mt-7 flex w-full items-center justify-center rounded-full bg-brand-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-400"
        >
          Scan a Card
        </Link>
        <Link
          href="/connect-ebay"
          className="mt-3 flex w-full items-center justify-center rounded-full border border-edge px-5 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-surface-2"
        >
          Connect eBay to Sell
        </Link>

        <p className="mt-5 text-xs text-zinc-500">
          A receipt is in your inbox.{" "}
          <Link href="/app/account" className="font-medium text-brand-300 transition hover:text-brand-200">
            {kind === "pack" ? "Your Account" : "Manage Billing"}
          </Link>
        </p>
      </div>
    </main>
  );
}
