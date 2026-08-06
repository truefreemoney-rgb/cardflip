"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import Spinner from "@/components/Spinner";
import OnboardingSteps from "@/components/OnboardingSteps";
import { connectEbay, signup } from "@/lib/client/auth";

const FIELD =
  "rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20";

const EBAY_PERMISSIONS = [
  "Create draft listings under your account",
  "Read your listing status so we can show progress",
];

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
  const [connecting, setConnecting] = useState(false);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed.");
      setSubmitting(false);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    // Real flow: redirect to eBay's OAuth authorize URL, then exchange the
    // callback code for tokens server-side once an eBay developer app exists.
    try {
      await connectEbay();
      router.push("/app");
    } catch {
      setConnecting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="mb-8">
        <Logo />
      </div>

      <OnboardingSteps current={phase === "account" ? 0 : 1} />

      {phase === "account" ? (
        <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface-1 p-8 shadow-xl shadow-black/40">
          <h1 className="text-xl font-semibold text-white">Create your account</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Free while we&apos;re in early access. You&apos;ll link eBay right after.
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
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={FIELD}
                placeholder="At least 6 characters"
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
              {submitting ? "Creating account…" : "Continue to link eBay"}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-zinc-600">
            By continuing you agree to the Terms and Privacy Policy.
          </p>
        </div>
      ) : (
        <div className="animate-fade-up w-full max-w-md rounded-2xl border border-edge bg-surface-1 p-8 text-center shadow-xl shadow-black/40">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-violet-600 text-2xl">
            🔗
          </div>

          <h1 className="mt-5 text-xl font-semibold text-white">
            You&apos;re in, {firstName}. Now link eBay.
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            You&apos;ll sign in on eBay and approve access. We never see your eBay
            password.
          </p>

          <ul className="mt-5 space-y-2 text-left">
            {EBAY_PERMISSIONS.map((permission) => (
              <li
                key={permission}
                className="flex items-start gap-2.5 text-sm text-zinc-300"
              >
                <span
                  className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[10px] text-emerald-400"
                  aria-hidden
                >
                  ✓
                </span>
                {permission}
              </li>
            ))}
          </ul>

          <button
            onClick={handleConnect}
            disabled={connecting}
            className="mt-7 flex w-full items-center justify-center gap-2 rounded-full bg-ebay px-5 py-3 text-sm font-semibold text-white transition hover:bg-ebay-hover disabled:opacity-70"
          >
            {connecting && <Spinner className="h-4 w-4" />}
            {connecting ? "Connecting…" : "Connect with eBay"}
          </button>

          <button
            onClick={() => router.push("/app")}
            disabled={connecting}
            className="mt-3 w-full text-xs text-zinc-500 transition hover:text-zinc-300 disabled:opacity-50"
          >
            Skip for now — I&apos;ll connect later
          </button>
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
