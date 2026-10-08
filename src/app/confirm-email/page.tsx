"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Logo from "@/components/Logo";
import Spinner from "@/components/Spinner";
import { fetchCurrentUser } from "@/lib/client/auth";
import { VerifyError, confirmLink, peekConfirmLink, type LinkState } from "@/lib/client/emailConfirm";
import { hasPendingScan } from "@/lib/client/trialScan";
import { hasPendingWatch } from "@/components/WatchPrice";

/**
 * The Confirm Email button in the mail lands here (/confirm-email?t=...).
 *
 * Opening the page only LOOKS at the link (a mail scanner's prefetch does the
 * same, so it must not confirm anything); the button does the confirming.
 * A fresh confirmation signs this browser in (10-05: the POST sets the session
 * cookie) and goes straight to /app, where the card scanned before signup is
 * waiting; an installed app still waiting on the original tab notices the
 * confirmation on its own. A link that was already used signs nobody in, so
 * once there is an answer the page asks who is signed in HERE, and labels its
 * one button Open CardFlip (a session) or Log In (none).
 */

type View =
  | { kind: "checking" }
  | { kind: "state"; state: LinkState; email: string | null }
  | { kind: "done"; email: string | null }
  | { kind: "taken" }
  /** The check itself failed (offline, a busy server); the link may be fine. */
  | { kind: "trouble"; message: string };

const CARD = "foil-edge relative w-full max-w-sm rounded-2xl p-8 shadow-xl shadow-black/40 [--foil-fill:#0b0d13]";

function ConfirmEmail() {
  const router = useRouter();
  const token = useSearchParams().get("t") ?? "";
  const [view, setView] = useState<View>(token ? { kind: "checking" } : { kind: "state", state: "expired", email: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // undefined = not asked yet; null = nobody signed in on this browser.
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  // Where a fresh confirmation goes (10-08): the open scanner, or the watchlist for a "Watch this price" signup.
  const [landing, setLanding] = useState<"/app?scan=1" | "/app/wishlist">("/app?scan=1");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    peekConfirmLink(token)
      .then((peek) => {
        if (cancelled) return;
        setView({ kind: "state", state: peek.state, email: peek.email });
        // No button to tap (10-05): a valid link confirms as the page opens. The GET peek above stays side-effect free
        // for mail scanners that fetch without running scripts.
        if (peek.state === "valid" || peek.state === "confirmed") void confirm();
      })
      .catch((err) => {
        if (!cancelled) setView({ kind: "trouble", message: err instanceof Error ? err.message : "We couldn't check this link. Try again." });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- confirm() runs once per peek, not per render
  }, [token, attempt]);

  // Whatever the answer turned out to be, the button underneath depends on
  // whether this browser has a session.
  const settled = view.kind === "done" || view.kind === "taken" || (view.kind === "state" && view.state !== "valid");
  useEffect(() => {
    if (!settled) return;
    let cancelled = false;
    fetchCurrentUser()
      .then((u) => {
        if (!cancelled) setSignedIn(Boolean(u));
      })
      .catch(() => {
        if (!cancelled) setSignedIn(false);
      });
    return () => {
      cancelled = true;
    };
  }, [settled]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const out = await confirmLink(token);
      if (out.signedIn) {
        // Signed in by the confirmation itself (10-05, Chris: no more taps): a beat of "Email confirmed", then the open scanner.
        // A signup that started from "Watch this price" with no card scanned lands on the watchlist instead
        // (10-08, Chris: "landed me on the scanner camera page").
        setView({ kind: "done", email: out.email });
        setSignedIn(true);
        const to = await Promise.all([hasPendingScan(), hasPendingWatch()])
          .then(([scan, watch]) => (watch && !scan ? ("/app/wishlist" as const) : ("/app?scan=1" as const)))
          .catch(() => "/app?scan=1" as const);
        setLanding(to);
        window.setTimeout(() => router.replace(to), 1200);
        return;
      }
      setView({ kind: "done", email: out.email });
    } catch (err) {
      if (err instanceof VerifyError && (err.code === "replaced" || err.code === "expired")) {
        setView({ kind: "state", state: err.code, email: null });
      } else if (err instanceof VerifyError && err.code === "email_taken") {
        setView({ kind: "taken" });
      } else {
        setError(err instanceof Error ? err.message : "That link didn't work. Try again.");
      }
    }
    setBusy(false);
  }

  const primary =
    "mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-brand-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-400 disabled:opacity-60";

  // One button for every finished state.
  const next =
    signedIn === undefined ? (
      <p className="mt-6 flex items-center justify-center gap-2 text-sm text-zinc-500">
        <Spinner className="h-4 w-4" /> One moment…
      </p>
    ) : (
      <Link href={signedIn ? "/app" : "/login"} className={primary}>
        {signedIn ? "Open CardFlip" : "Log In"}
      </Link>
    );

  let heading = "Confirm your email";
  let content: React.ReactNode;
  if (view.kind === "checking") {
    content = (
      <p className="mt-6 flex items-center gap-2 text-sm text-zinc-400">
        <Spinner className="h-4 w-4" /> Checking your link…
      </p>
    );
  } else if (view.kind === "trouble") {
    content = (
      <>
        <p role="alert" className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400">
          {view.message}
        </p>
        <button
          type="button"
          onClick={() => {
            setView({ kind: "checking" });
            setAttempt((n) => n + 1);
          }}
          className={primary}
        >
          Try Again
        </button>
      </>
    );
  } else if (view.kind === "done") {
    heading = "Email confirmed";
    content = (
      <>
        {signedIn ? (
          <p className="mt-6 flex items-center justify-center gap-2 text-sm text-zinc-300">
            <Spinner className="h-4 w-4" /> {landing === "/app/wishlist" ? "Opening your watchlist…" : "Opening your scanner…"}
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm leading-relaxed text-zinc-300">
              {view.email ? <>{view.email} is confirmed. </> : null}
              If you signed up in the CardFlip app on your home screen, open it from there.
            </p>
            {next}
          </>
        )}
      </>
    );
  } else if (view.kind === "taken") {
    heading = "That email is already in use";
    content = (
      <>
        <p className="mt-3 text-sm leading-relaxed text-zinc-300">Another CardFlip account already uses this address, so it can&apos;t be confirmed here.</p>
        {next}
      </>
    );
  } else if (view.state === "valid") {
    content = (
      <>
        <p className="mt-3 text-sm leading-relaxed text-zinc-300">
          {view.email ? <>Confirm {view.email} for your CardFlip account.</> : "Confirm this address for your CardFlip account."}
        </p>
        <p role="alert" aria-live="polite" className="min-h-0">
          {error && <span className="mt-4 block rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400">{error}</span>}
        </p>
        <button type="button" onClick={() => void confirm()} disabled={busy} className={primary}>
          {busy && <Spinner className="h-4 w-4" />}
          {busy ? "Confirming…" : "Confirm and open CardFlip"}
        </button>
      </>
    );
  } else if (view.state === "confirmed") {
    heading = "Your email is already confirmed";
    content = (
      <>
        <p className="mt-3 text-sm leading-relaxed text-zinc-300">Nothing more to do here.</p>
        {next}
      </>
    );
  } else if (view.state === "replaced") {
    heading = "This link was replaced";
    content = (
      <>
        <p className="mt-3 text-sm leading-relaxed text-zinc-300">This link was replaced by a newer email. Use the newest one.</p>
        {next}
      </>
    );
  } else {
    heading = "This link has expired";
    content = (
      <>
        <p className="mt-3 text-sm leading-relaxed text-zinc-300">Open CardFlip and tap Send a new link.</p>
        {next}
      </>
    );
  }

  return (
    <div className={CARD}>
      <h1 className="text-xl font-semibold text-white">{heading}</h1>
      {content}
    </div>
  );
}

export default function ConfirmEmailPage() {
  return (
    <div className="hero-mesh grain relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-4 py-12 text-foreground">
      <div className="relative mb-8">
        <Logo />
      </div>
      {/* useSearchParams needs a Suspense boundary for static rendering. */}
      <Suspense fallback={null}>
        <ConfirmEmail />
      </Suspense>
      <Link href="/" className="mt-6 text-sm text-zinc-500 transition hover:text-zinc-300">
        ← Back to home
      </Link>
    </div>
  );
}
