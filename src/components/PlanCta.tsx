"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Spinner from "@/components/Spinner";
import { fetchCurrentUser, type SessionUser } from "@/lib/client/auth";
import { openBillingPortal, startCheckout } from "@/lib/client/accountApi";

/**
 * The button on each plan card (landing + /pricing). Signed out: every card
 * goes to /signup. Signed in (Chris, 09-06: "subscribe now should lead to a
 * page that has the 3 options"): the paid cards open Stripe Checkout for
 * that plan directly, the free card just goes to the app, and a seller who
 * already has a plan sees "Current plan" / "Switch in billing" instead of a
 * second checkout. Session is fetched here because these pages sit outside
 * the /app SessionProvider.
 */
export default function PlanCta({
  plan,
  cta,
  primary,
}: {
  plan: "trial" | "standard" | "pro";
  cta: string;
  primary: boolean;
}) {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser()
      .then((u) => {
        if (!cancelled) setUser(u);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cls = `mt-7 flex w-full items-center justify-center gap-2 rounded-full px-7 py-3.5 text-center text-sm font-semibold transition ${
    primary
      ? "sheen bg-brand-500 text-white shadow-lg shadow-brand-500/25 hover:bg-brand-400"
      : "border border-edge-strong bg-white/5 text-white hover:bg-white/10"
  } disabled:cursor-default disabled:opacity-60`;

  // Signed out (or still checking): the original signup link. Keeps the
  // server-rendered markup identical for crawlers and the first paint.
  if (!user) {
    return (
      <Link href="/signup" className={cls}>
        {cta}
      </Link>
    );
  }

  // The TIER is the truth (server-resolved, honours admin overrides) — not
  // the raw Stripe status, which stays "active" under a Trial override.
  const subscribed = user.role === "admin" || user.tier === "subscribed" || user.tier === "owner";
  const current = subscribed && ((plan === "pro" && user.plan === "pro") || (plan === "standard" && user.plan !== "pro"));

  if (plan === "trial") {
    return (
      <Link href="/app" className={cls}>
        {subscribed ? "Open the App" : "Back to Scanning"}
      </Link>
    );
  }

  async function go(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      window.location.assign(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <>
      {current ? (
        <button type="button" disabled className={cls}>
          Your Current Plan
        </button>
      ) : subscribed ? (
        <button type="button" onClick={() => go(openBillingPortal)} disabled={busy} className={cls}>
          {busy ? <Spinner className="h-4 w-4" /> : null}
          {busy ? "Opening…" : plan === "pro" ? "Switch to Pro in Billing" : "Switch to CardFlip in Billing"}
        </button>
      ) : (
        <button type="button" onClick={() => go(() => startCheckout(plan))} disabled={busy} className={cls}>
          {busy ? <Spinner className="h-4 w-4" /> : null}
          {busy ? "Opening Checkout…" : cta}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}
    </>
  );
}
