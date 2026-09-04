"use client";

import PasswordField from "@/components/PasswordField";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import Spinner from "@/components/Spinner";
import OnboardingSteps from "@/components/OnboardingSteps";
import EbayConnectCard from "@/components/EbayConnectCard";
import DevLoginButton from "@/components/DevLoginButton";
import { fetchCurrentUser, signup } from "@/lib/client/auth";

const FIELD =
  "rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-base text-white outline-none sm:text-sm transition placeholder:text-zinc-600 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20";

type Phase = "account" | "ebay";

export default function SignupPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("account");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");

  // `?step=ebay` + a live session = the account already exists; resume on
  // the eBay step instead of asking them to sign up again.
  useEffect(() => {
    const ebayStep = new URLSearchParams(window.location.search).get("step") === "ebay";
    let alive = true;
    fetchCurrentUser().then((u) => {
      if (!alive || !u) return;
      if (ebayStep) {
        setFirstName(u.name.split(" ")[0]);
        setPhase("ebay");
      } else {
        // Already signed in: the account-creation form would only create a
        // duplicate (Chris, 08-27, after "Start selling free" handed him a
        // signup form on a live session). Straight to the app instead.
        router.replace("/app");
      }
    });
    return () => { alive = false; };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) return setError("Enter your name.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Enter a valid email address.");
    if (password.length < 6)
      return setError("Password must be at least 6 characters.");

    setSubmitting(true);
    try {
      const user = await signup(name.trim(), email.trim(), password);
      // Stay on this page and slide straight into the eBay step — no reload,
      // no separate route, so linking eBay reads as part of signing up.
      setFirstName(user.name.split(" ")[0]);
      setPhase("ebay");
      // Mark the step in the URL so a refresh (or coming back from eBay's
      // sign-in) lands on step 2, not on an empty account form.
      window.history.replaceState(null, "", "/signup?step=ebay");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed.");
      setSubmitting(false);
    }
  }

  return (
    <div className="hero-mesh grain relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-4 py-12 text-foreground">
      <div className="relative mb-8">
        <Logo />
      </div>

      <OnboardingSteps current={phase === "account" ? 0 : 1} />

      {phase === "account" ? (
        <div className="foil-edge relative w-full max-w-sm rounded-2xl p-8 shadow-xl shadow-black/40 [--foil-fill:#0b0d13]">
          <h1 className="text-xl font-semibold text-white">Create your account</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Free while we&apos;re in early access — start scanning right away.
          </p>

          <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="name" className="text-sm font-medium text-zinc-300">
                Full name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                autoFocus
                enterKeyHint="next"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={FIELD}
                placeholder="Ash Ketchum"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-medium text-zinc-300">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                enterKeyHint="next"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={FIELD}
                placeholder="you@example.com"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-sm font-medium text-zinc-300">
                Password
              </label>
              <PasswordField
                id="password"
                name="password"
                autoComplete="new-password"
                enterKeyHint="go"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={FIELD}
                placeholder="At least 6 characters"
                hint
              />
            </div>

            <p role="alert" aria-live="polite" className="min-h-0">
              {error && (
                <span className="block rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400">
                  {error}
                </span>
              )}
            </p>

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 flex items-center justify-center gap-2 rounded-full bg-brand-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-400 disabled:opacity-60"
            >
              {submitting && <Spinner className="h-4 w-4" />}
              {submitting ? "Creating account…" : "Create account"}
            </button>
          </form>

          <DevLoginButton />

          <p className="mt-6 text-center text-xs text-zinc-600">
            By continuing you agree to the{" "}
            <Link href="/terms" className="underline transition hover:text-zinc-300">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline transition hover:text-zinc-300">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="animate-fade-up w-full max-w-md">
          {/* useSearchParams inside the card needs a Suspense boundary to build. */}
          <Suspense fallback={null}>
            <EbayConnectCard
              firstName={firstName}
              doneLabel="Start scanning · 10 free"
              onDone={() => router.push("/app")}
            />
          </Suspense>
        </div>
      )}

      <Link
        href="/"
        className="mt-6 text-sm text-zinc-500 transition hover:text-zinc-300"
      >
        ← Back to home
      </Link>
    </div>
  );
}
