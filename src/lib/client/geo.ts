"use client";

import { useEffect, useState } from "react";
import { useOptionalSession } from "@/components/SessionProvider";
import { currencyFor } from "@/lib/countries";

/** The visitor's IP country from /api/geo, once per tab session; null off Vercel or on failure. */
export async function visitorCountry(): Promise<string | null> {
  try {
    const cached = sessionStorage.getItem("cf_geo");
    if (cached !== null) return cached || null;
  } catch {}
  try {
    const res = await fetch("/api/geo", { cache: "no-store" });
    const c: string | null = res.ok ? ((await res.json())?.country ?? null) : null;
    try {
      sessionStorage.setItem("cf_geo", c ?? "");
    } catch {}
    return c;
  } catch {
    return null;
  }
}

let ratesPromise: Promise<Record<string, number>> | null = null;
function fxRates(): Promise<Record<string, number>> {
  ratesPromise ??= fetch("/api/fx")
    .then((r): Promise<{ rates?: Record<string, number> }> => (r.ok ? r.json() : Promise.resolve({})))
    .then((b) => (b?.rates && typeof b.rates === "object" ? b.rates : {}))
    .catch(() => {
      ratesPromise = null; // try again next mount
      return {};
    });
  return ratesPromise;
}

/**
 * The viewer's billing/display currency code ("GBP"), or null until known and
 * for USD viewers. Signed in: the HOME country; signed out: the IP country.
 */
export function useViewerCurrency(): string | null {
  const session = useOptionalSession();
  const signedIn = session?.status === "ready" && session.user;
  const home = signedIn ? (session.user?.homeCountry ?? null) : undefined;
  const [cur, setCur] = useState<string | null>(null);
  useEffect(() => {
    if (session?.status === "loading") return;
    let alive = true;
    (async () => {
      const country = home !== undefined ? home : await visitorCountry();
      const c = currencyFor(country);
      if (alive) setCur(c === "USD" ? null : c);
    })();
    return () => {
      alive = false;
    };
  }, [home, session?.status]);
  return cur;
}

export interface HomeCurrency {
  currency: string;
  /** 1 USD = rate units of currency. */
  rate: number;
}

/**
 * The home-currency hint for this viewer, or null (USD viewer, rates missing).
 * Signed in: the account's HOME country (Chris 09-30: prices do not change
 * while travelling). Signed out: the IP country.
 */
export function useHomeCurrency(): HomeCurrency | null {
  const session = useOptionalSession();
  const signedIn = session?.status === "ready" && session.user;
  const home = signedIn ? (session.user?.homeCountry ?? null) : undefined;
  const [hint, setHint] = useState<HomeCurrency | null>(null);

  useEffect(() => {
    if (session?.status === "loading") return;
    let alive = true;
    (async () => {
      const country = home !== undefined ? home : await visitorCountry();
      const currency = currencyFor(country);
      if (currency === "USD") return alive && setHint(null);
      const rate = (await fxRates())[currency];
      if (alive) setHint(typeof rate === "number" && rate > 0 ? { currency, rate } : null);
    })();
    return () => {
      alive = false;
    };
  }, [home, session?.status]);

  return hint;
}

/** "≈ £12.40" — en-US formatting keeps CA$, A$ and NZ$ unambiguous next to US$. */
export function formatLocal(usd: number, h: HomeCurrency): string {
  return `≈ ${new Intl.NumberFormat("en-US", { style: "currency", currency: h.currency }).format(usd * h.rate)}`;
}
