"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import Spinner from "@/components/Spinner";
import { useSession } from "@/components/SessionProvider";
import { logout } from "@/lib/client/auth";
import { openBillingPortal, startCheckout } from "@/lib/client/accountApi";

/**
 * What a signed-in seller without an active subscription sees on every app
 * page (paid-only from 09-04, Chris: "demo is over"). One plan, one button.
 * A lapsed subscriber gets the billing portal too, so a failed card is one
 * tap to fix. Admins never land here (SubscriptionGate lets them through).
 */
export default function Paywall() {
  const router = useRouter();
  const { user, refresh } = useSession();
  const [busy, setBusy] = useState<"checkout" | "pro" | "portal" | "refresh" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lapsed = Boolean(user?.subStatus);

  async function go(kind: "checkout" | "pro" | "portal", fn: () => Promise<string>) {
    setBusy(kind);
    setError(null);
    try {
      window.location.assign(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — try again");
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <Logo />
      <h1 className="mt-8 font-display text-3xl font-bold text-white sm:text-4xl">
        {lapsed ? "Your subscription has ended." : "Your 10 free scans are used."}
      </h1>
      <p className="mt-3 max-w-md text-zinc-400">
        {lapsed
          ? "Your cards and settings are still here. Pick the plan back up to keep scanning, pricing and posting."
          : "Everything you scanned is saved. Keep going for $9.99 a month: 500 scans, live pricing for the exact printing, eBay listings written and published for you. Cancel any time."}
      </p>

      <div className="foil-edge mt-8 w-full rounded-2xl p-6 text-left [--foil-fill:#0b0d13]">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-lg font-semibold text-white">CardFlip</span>
          <span>
            <span className="font-display text-3xl font-bold text-white">$9.99</span>
            <span className="text-sm text-zinc-500">/month</span>
          </span>
        </div>
        <ul className="mt-4 space-y-2 text-sm text-zinc-300">
          {[
            "500 card scans a month",
            "TCGplayer market price per printing and variant, live eBay comps",
            "eBay listings written, published and repriced from CardFlip",
            "Inventory, categories, sales tracking and the watchlist",
          ].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <span className="mt-0.5 text-emerald-400" aria-hidden>
                ✓
              </span>
              {line}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => go("checkout", () => startCheckout("standard"))}
          disabled={busy !== null}
          className="sheen mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-400 disabled:opacity-60"
        >
          {busy === "checkout" ? <Spinner className="h-4 w-4" /> : null}
          {busy === "checkout" ? "Opening checkout…" : lapsed ? "Resubscribe · $9.99/mo" : "Subscribe · $9.99/mo"}
        </button>
        <button
          type="button"
          onClick={() => go("pro", () => startCheckout("pro"))}
          disabled={busy !== null}
          className="mt-2 w-full rounded-full border border-edge px-6 py-3 text-sm font-medium text-zinc-300 transition hover:border-edge-strong hover:text-white disabled:opacity-60"
        >
          {busy === "pro" ? "Opening checkout…" : "Pro · $24.99/mo · 2,000 scans"}
        </button>
        {lapsed && (
          <button
            type="button"
            onClick={() => go("portal", openBillingPortal)}
            disabled={busy !== null}
            className="mt-2 w-full rounded-full border border-edge px-6 py-3 text-sm font-medium text-zinc-300 transition hover:border-edge-strong hover:text-white disabled:opacity-60"
          >
            {busy === "portal" ? "Opening…" : "Manage billing"}
          </button>
        )}
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
        <p className="mt-3 text-center text-xs text-zinc-500">You keep 100% of every eBay payout.</p>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-zinc-500">
        <button
          type="button"
          onClick={async () => {
            setBusy("refresh");
            await refresh();
            setBusy(null);
          }}
          disabled={busy !== null}
          className="transition hover:text-zinc-300 disabled:opacity-60"
        >
          {busy === "refresh" ? "Checking…" : "Just subscribed? Refresh"}
        </button>
        <Link href="/app/account" className="transition hover:text-zinc-300">
          Account
        </Link>
        <Link href="/help" className="transition hover:text-zinc-300">
          Help
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
