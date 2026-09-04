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
 * page (paid-only from 09-04). One sentence, one button (Chris, 09-04: build
 * for the average user — they already used the product, no feature list).
 * Pro is a quiet line under the button, never a second card. A lapsed
 * subscriber gets the billing portal as a text link so a failed card is one
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
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setBusy(null);
    }
  }

  const quiet =
    "text-sm text-zinc-500 underline-offset-4 transition hover:text-zinc-300 hover:underline disabled:opacity-60";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <Logo />
      <h1 className="mt-8 font-display text-3xl font-bold text-white sm:text-4xl">
        {lapsed ? "Your subscription ended." : "Your 10 free scans are used."}
      </h1>
      <p className="mt-3 text-lg text-zinc-300">
        {lapsed ? "Everything is still here. Pick it back up for $9.99 a month." : "Keep going for $9.99 a month."}
      </p>

      <button
        type="button"
        onClick={() => go("checkout", () => startCheckout("standard"))}
        disabled={busy !== null}
        className="sheen mt-8 flex w-full items-center justify-center gap-2 rounded-full bg-brand-500 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-400 disabled:opacity-60"
      >
        {busy === "checkout" ? <Spinner className="h-4 w-4" /> : null}
        {busy === "checkout" ? "Opening checkout…" : lapsed ? "Resubscribe" : "Subscribe"}
      </button>
      <p className="mt-2 text-xs text-zinc-500">500 scans a month. Cancel any time.</p>

      {error && (
        <p role="alert" className="mt-4 w-full rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="mt-8 flex flex-col items-center gap-2">
        <button type="button" onClick={() => go("pro", () => startCheckout("pro"))} disabled={busy !== null} className={quiet}>
          {busy === "pro" ? "Opening checkout…" : "Need more? Pro is 2,000 scans for $24.99 a month."}
        </button>
        {lapsed && (
          <button type="button" onClick={() => go("portal", openBillingPortal)} disabled={busy !== null} className={quiet}>
            {busy === "portal" ? "Opening…" : "Fix a failed card"}
          </button>
        )}
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-zinc-600">
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
