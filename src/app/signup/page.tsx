"use client";

import PasswordField from "@/components/PasswordField";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import Spinner from "@/components/Spinner";
import OnboardingSteps, { CONFIRM_STEPS } from "@/components/OnboardingSteps";
import ConfirmEmailPanel from "@/components/ConfirmEmailPanel";
import DevLoginButton from "@/components/DevLoginButton";
import { fetchCurrentUser, signup, type SessionUser } from "@/lib/client/auth";
import { mergeUser } from "@/lib/client/emailConfirm";
import { readReferralCode } from "@/components/RefCapture";
import { readTouch } from "@/components/AttributionCapture";
import { PRICING, SCANS } from "@/lib/pricing";

const FIELD =
  "rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-base text-white outline-none sm:text-sm transition placeholder:text-zinc-600 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20";

/** account -> (confirm, only while email confirmation is on) -> ebay, the "You're in" step. */
type Phase = "account" | "confirm" | "ebay";

export default function SignupPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("account");
  // The account as the server last described it. The "You're in" step reads
  // its trialScansLeft (a repeat signup on a shared device is zeroed when its
  // code is typed, so the count is not always the full trial).
  const [account, setAccount] = useState<SessionUser | null>(null);
  // True once this signup went through the confirm step: three steps, not two.
  const [confirmFlow, setConfirmFlow] = useState(false);
  const [refused, setRefused] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Errors take focus (QA leftover): announced, and scrolled into view on a phone.
  const alertRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  const [firstName, setFirstName] = useState("");

  // `?step=welcome` (or the old `?step=ebay`) + a live session = the account
  // already exists; resume on step 2 instead of asking them to sign up again.
  useEffect(() => {
    const step = new URLSearchParams(window.location.search).get("step");
    const welcomeStep = step === "welcome" || step === "ebay";
    let alive = true;
    fetchCurrentUser().then((u) => {
      if (!alive || !u) return;
      if (welcomeStep) {
        setFirstName(u.name.split(" ")[0]);
        setAccount(u);
        // Still waiting on the emailed code (the phone was killed while the
        // person was in Mail): back to the code step, not past it.
        if (u.mustConfirmEmail) {
          setConfirmFlow(true);
          setPhase("confirm");
        } else {
          setPhase("ebay");
        }
      } else {
        // Already signed in: the account-creation form would only create a
        // duplicate (Chris, 08-27, after "Start selling free" handed him a
        // signup form on a live session). Straight to the app instead.
        router.replace("/app");
      }
    }).catch(() => {
      // Offline / 5xx: the form still works — the signup POST reports its own error.
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
      const result = await signup(name.trim(), email.trim(), password, readReferralCode(), readTouch());
      const user = result.user;
      // Stay on this page and slide straight into the next step: the code
      // (email confirmation on) or the welcome step.
      setFirstName(user.name.split(" ")[0]);
      setAccount(user);
      if (user.mustConfirmEmail) {
        setConfirmFlow(true);
        setRefused(result.emailProblem === "recipient");
        setPhase("confirm");
      } else {
        setPhase("ebay");
      }
      // Mark the step in the URL so a refresh lands on step 2, not on an
      // empty account form.
      window.history.replaceState(null, "", "/signup?step=welcome");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed.");
      setSubmitting(false);
    }
  }

  // The code (or the link, or a released wall) let the account in.
  function onConfirmed(user: SessionUser) {
    setAccount((prev) => mergeUser(prev, user));
    setFirstName(user.name.split(" ")[0]);
    setPhase("ebay");
  }

  // With the confirm step, "You're in" reads the count the server settled at
  // confirmation: a second signup on a shared device or network starts with the
  // free scans spent. Without it (confirmation off) the screen is what it
  // always was, the full trial from the pricing constant.
  const scansLeft = confirmFlow ? (account?.trialScansLeft ?? 0) : PRICING.trial.scans;

  return (
    <div className="hero-mesh grain relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-4 py-12 text-foreground">
      <div className="relative mb-8">
        <Logo />
      </div>

      {confirmFlow ? (
        <OnboardingSteps current={phase === "account" ? 0 : phase === "confirm" ? 1 : 2} steps={CONFIRM_STEPS} />
      ) : (
        <OnboardingSteps current={phase === "account" ? 0 : 1} />
      )}

      {phase === "account" ? (
        <div className="foil-edge relative w-full max-w-sm rounded-2xl p-8 shadow-xl shadow-black/40 [--foil-fill:#0b0d13]">
          <h1 className="text-xl font-semibold text-white">Create your account</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {SCANS.trial} free scans, no card needed.
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

            <p ref={alertRef} tabIndex={-1} role="alert" aria-live="polite" className="min-h-0 outline-none">
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
              {submitting ? "Creating Account…" : "Create Account"}
            </button>
          </form>

          <DevLoginButton />

          <p className="mt-5 text-center text-sm text-zinc-400">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-brand-300 transition hover:text-brand-200">
              Log In
            </Link>
          </p>

          <p className="mt-3 text-center text-xs text-zinc-600">
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
      ) : phase === "confirm" && account ? (
        // The wall's twin: same panel, inside the signup card. Signup sits
        // outside SessionProvider, so the panel reports back through props.
        <div className="foil-edge animate-fade-up relative w-full max-w-sm rounded-2xl p-6 shadow-xl shadow-black/40 [--foil-fill:#0b0d13] sm:p-8">
          <ConfirmEmailPanel
            mode="signup"
            user={account}
            refused={refused}
            onUser={(next) => setAccount((prev) => mergeUser(prev, next))}
            onConfirmed={onConfirmed}
          />
        </div>
      ) : (
        // Step 2 is the two things a new account can do: scan free or
        // subscribe. eBay lives behind one link (Chris, 09-25: the eBay
        // rambling belongs after "Connect eBay", not on the welcome screen).
        // The free-scan promise is the count the server settled, never a
        // constant: a repeat signup on a shared device gets plan-first copy.
        <div className="foil-edge animate-fade-up relative w-full max-w-sm rounded-2xl p-8 text-center shadow-xl shadow-black/40 [--foil-fill:#0b0d13]">
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-2xl text-emerald-400"
            aria-hidden
          >
            ✓
          </div>
          <h1 className="mt-5 text-xl font-semibold text-white">
            You&apos;re in{firstName ? `, ${firstName}` : ""}
          </h1>
          {scansLeft > 0 ? (
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Your first {scansLeft === 1 ? "scan is" : `${scansLeft} scans are`} free. Point your camera at a card and CardFlip
              names it and prices it.
            </p>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              The free scans have already been used on this device or network, so pick a plan to start scanning.
            </p>
          )}

          {scansLeft > 0 ? (
            <>
              <button
                onClick={() => router.push("/app")}
                className="mt-7 w-full rounded-full bg-brand-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-400"
              >
                Start Scanning · {scansLeft} Free
              </button>
              <button
                onClick={() => router.push("/pricing")}
                className="mt-3 w-full rounded-full border border-edge px-5 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-surface-2"
              >
                Subscribe Now
              </button>
            </>
          ) : (
            <button
              onClick={() => router.push("/pricing")}
              className="mt-7 w-full rounded-full bg-brand-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-400"
            >
              Pick a Plan
            </button>
          )}

          <p className="mt-5 text-xs text-zinc-500">
            Selling on eBay?{" "}
            <Link href="/connect-ebay" className="font-medium text-brand-300 transition hover:text-brand-200">
              Connect eBay
            </Link>
          </p>
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
