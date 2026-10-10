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
import GoogleButton, { googleErrorFromUrl } from "@/components/GoogleButton";
import { xErrorFromUrl } from "@/components/XButton";
import { pixelTrack } from "@/lib/client/pixel";
import { fetchCurrentUser, signup, type SessionUser } from "@/lib/client/auth";
import { updateProfile } from "@/lib/client/accountApi";
import { mergeUser } from "@/lib/client/emailConfirm";
import { readReferralCode, readTouch } from "@/components/AttributionCapture";
import { PRICING, SCANS } from "@/lib/pricing";
import { PASSWORD_MIN, passwordProblem } from "@/lib/passwordRules";
import { suggestEmail } from "@/lib/emailTypo";

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
  const [emailLeft, setEmailLeft] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Errors take focus (QA leftover): announced, and scrolled into view on a phone.
  const alertRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);
  // Sent back from Google without finishing (/api/auth/google/callback): say so in the same error slot.
  useEffect(() => {
    const fromGoogle = googleErrorFromUrl() ?? xErrorFromUrl();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is browser-only, read once after hydration
    if (fromGoogle) setError(fromGoogle);
  }, []);
  // /signup?step=welcome&google=new: the Google callback just made this account. The server's
  // free-scan count is the truth (a repeat device starts spent), and the registration event fires once.
  const [googleNew] = useState(() => {
    if (typeof window === "undefined") return false;
    const q = new URLSearchParams(window.location.search);
    return q.get("google") === "new" || q.get("x") === "new"; // x=new: the same, from Continue with X
  });
  // /signup?x=email: X did not share an email, so this is the one-field step (POST /api/auth/x/finish).
  const [xEmailStep] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("x") === "email",
  );
  const [xEmail, setXEmail] = useState("");
  const [xEmailLeft, setXEmailLeft] = useState(false);

  async function handleXFinish(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^S+@S+.S+$/.test(xEmail)) return setError("Enter a valid email address.");
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/x/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: xEmail.trim() }),
      });
      const data = (await res.json().catch(() => null)) as { next?: unknown; error?: unknown } | null;
      if (!res.ok || typeof data?.next !== "string") {
        setError(typeof data?.error === "string" ? data.error : "Sign up failed.");
        setSubmitting(false);
        return;
      }
      pixelTrack("CompleteRegistration");
      // A full load: the page resumes on the code step from the live session.
      window.location.assign(data.next);
    } catch {
      setError("Sign up failed.");
      setSubmitting(false);
    }
  }

  const [firstName, setFirstName] = useState("");
  // Ad-page signups (/scan -> /signup?from=scan): no mode question, straight to the scanner.
  const [fromScan] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("from") === "scan",
  );

  // `?step=welcome` (or the old `?step=ebay`) + a live session = the account
  // already exists; resume on step 2 instead of asking them to sign up again.
  useEffect(() => {
    const step = new URLSearchParams(window.location.search).get("step");
    const welcomeStep = step === "welcome" || step === "ebay";
    let alive = true;
    fetchCurrentUser().then((u) => {
      if (!alive || !u) return;
      if (welcomeStep) {
        if (googleNew) {
          // Once per account: a refresh or a second visit to this URL must not count another signup.
          try {
            const key = `cf.gsignup.${u.id}`;
            if (!localStorage.getItem(key)) {
              localStorage.setItem(key, "1");
              pixelTrack("CompleteRegistration");
            }
          } catch {
            pixelTrack("CompleteRegistration");
          }
        }
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
  }, [router, googleNew]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) return setError("Enter a username.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Enter a valid email address.");
    const pwProblem = passwordProblem(password);
    if (pwProblem) return setError(pwProblem);

    setSubmitting(true);
    try {
      // from=scan marks the ad page: it becomes the landing so the admin funnel can tell these apart.
      const stored = readTouch();
      const touch = fromScan
        ? { s: "direct", m: "", c: "", refHost: "", t: Date.now(), ...stored, landing: "/scan" }
        : stored;
      const result = await signup(name.trim(), email.trim(), password, readReferralCode(), touch);
      const user = result.user;
      pixelTrack("CompleteRegistration");
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
      window.history.replaceState(null, "", fromScan ? "/signup?step=welcome&from=scan" : "/signup?step=welcome");
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
  const scansLeft = googleNew ? (account?.trialScansLeft ?? 0) : confirmFlow ? (account?.trialScansLeft ?? 0) : PRICING.trial.scans;

  // The welcome question (10-04, docs/PRICING-ONLY-PLAN.md): asked once, here.
  // Either answer saves the mode and moves on; a failed save still moves on
  // (the switch lives in Inventory and Account).
  const [choosing, setChoosing] = useState<"sell" | "price" | null>(null);
  async function chooseMode(mode: "sell" | "price") {
    if (choosing) return;
    setChoosing(mode);
    try {
      await updateProfile({ pricingOnly: mode === "price" });
    } catch {
      // Moving on anyway: the choice can be made again from Inventory.
    }
    router.push(scansLeft > 0 ? (fromScan ? "/app?scan=1" : "/app") : "/pricing");
  }
  // Came from the ad page: Seller (the normal mode) by default, no question.
  useEffect(() => {
    if (fromScan && phase === "ebay" && account) queueMicrotask(() => void chooseMode("sell"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromScan, phase, account]);

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

      {phase === "account" && xEmailStep ? (
        <div className="foil-edge relative w-full max-w-sm rounded-2xl p-8 shadow-xl shadow-black/40 [--foil-fill:#0b0d13]">
          <h1 className="text-xl font-semibold text-white">One more thing</h1>
          <p className="mt-1 text-sm text-zinc-400">X didn&apos;t share your email. Where should we send your card alerts?</p>

          <form onSubmit={handleXFinish} noValidate className="mt-5 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="x-email" className="text-sm font-medium text-zinc-300">
                Email
              </label>
              <input
                id="x-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                enterKeyHint="go"
                autoFocus
                value={xEmail}
                onChange={(e) => setXEmail(e.target.value)}
                onBlur={() => setXEmailLeft(true)}
                className={FIELD}
                placeholder="you@example.com"
              />
              {(() => {
                const fix = xEmailLeft ? suggestEmail(xEmail) : null;
                return fix ? (
                  <button type="button" onClick={() => setXEmail(fix)} className="text-left text-sm text-amber-300">
                    Did you mean <span className="font-semibold underline underline-offset-2">{fix}</span>?
                  </button>
                ) : null;
              })()}
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
              {submitting ? "Finishing…" : "Finish signup"}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-zinc-400">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-brand-300 transition hover:text-brand-200">
              Log In
            </Link>
          </p>
        </div>
      ) : phase === "account" ? (
        <div className="foil-edge relative w-full max-w-sm rounded-2xl p-8 shadow-xl shadow-black/40 [--foil-fill:#0b0d13]">
          <h1 className="text-xl font-semibold text-white">Create your account</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {SCANS.trial} free scans, no card needed.
          </p>

          <GoogleButton mode="signup" />

          <form onSubmit={handleSubmit} noValidate className="mt-5 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="name" className="text-sm font-medium text-zinc-300">
                {/* Chris 10-07: "Username" reads lighter than "First name" (4 of 6 ad visitors left this form). Still the account's display name, not unique. */}
                Username
              </label>
              <input
                id="name"
                name="name"
                type="text"
                autoComplete="nickname"
                autoFocus
                enterKeyHint="next"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={FIELD}
                placeholder="Enter username"
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
                onBlur={() => setEmailLeft(true)}
                className={FIELD}
                placeholder="you@example.com"
              />
              {/* 10-07: an ad signup typed @iclod.org, the welcome email bounced and they signed up twice.
                  Only after they leave the box, so it doesn't flicker mid-typing (gm → gmx.com). */}
              {(() => {
                const fix = emailLeft ? suggestEmail(email) : null;
                return fix ? (
                  <button
                    type="button"
                    onClick={() => setEmail(fix)}
                    className="text-left text-sm text-amber-300"
                  >
                    Did you mean <span className="font-semibold underline underline-offset-2">{fix}</span>?
                  </button>
                ) : null;
              })()}
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
                placeholder={`At least ${PASSWORD_MIN} characters`}
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

          <p className="mt-6 font-display text-lg font-semibold text-white">How will you use it?</p>
          <div className="mt-3 flex flex-col gap-2.5 text-left">
            {([
              ["sell", "I sell on eBay", "Scan, price, and list cards on eBay in one tap."],
              ["price", "I collect", "Market prices and what your cards are worth. Nothing about eBay."],
            ] as const).map(([mode, title, line]) => (
              <button
                key={mode}
                type="button"
                disabled={choosing !== null}
                onClick={() => void chooseMode(mode)}
                className="flex items-center gap-3 rounded-2xl border border-edge bg-surface-1 px-4 py-3.5 text-left transition hover:border-brand-400 hover:bg-brand-500/10 disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold text-white">{title}</span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-zinc-400">{line}</span>
                </span>
                {choosing === mode ? <Spinner className="h-4 w-4 shrink-0" /> : <span aria-hidden className="shrink-0 text-brand-300">→</span>}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-zinc-500">You can change this any time from Account or Inventory.</p>

          {scansLeft > 0 && (
            <button
              type="button"
              onClick={() => router.push("/pricing")}
              className="mt-5 text-sm font-medium text-brand-300 underline-offset-4 transition hover:text-brand-200 hover:underline"
            >
              Or Subscribe Now
            </button>
          )}
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
