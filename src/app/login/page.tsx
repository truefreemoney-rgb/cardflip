"use client";

import PasswordField from "@/components/PasswordField";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import Spinner from "@/components/Spinner";
import DevLoginButton from "@/components/DevLoginButton";
import { TotpRequiredError, afterLoginPath, fetchCurrentUser, login, startDemoSession } from "@/lib/client/auth";

const FIELD =
  "rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-base text-white outline-none sm:text-sm transition placeholder:text-zinc-600 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in? Straight to the app. Without this the page always
  // shows the empty form, which -- paired with the old always-logged-out
  // marketing nav -- convinced signed-in sellers the homepage had logged
  // them out (Chris, 08-27) and walked them through a pointless login.
  useEffect(() => {
    let alive = true;
    fetchCurrentUser()
      .then((user) => {
        if (alive && user) router.replace(afterLoginPath());
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (needsCode && !/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setSubmitting(true);
    try {
      await login(email.trim(), password, needsCode ? code.trim() : undefined);
      // replace, not push: Back from the app must not land on a login form.
      router.replace(afterLoginPath());
    } catch (err) {
      if (err instanceof TotpRequiredError) {
        // Password was right; the account has two-step on. First time through
        // is a prompt, not an error — only a wrong code reads as one.
        if (needsCode) setError(err.message);
        setNeedsCode(true);
        setCode("");
      } else {
        setError(err instanceof Error ? err.message : "Login failed.");
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="hero-mesh grain relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-4 py-12 text-foreground">
      <div className="relative mb-8">
        <Logo />
      </div>

      <div className="foil-edge relative w-full max-w-sm rounded-2xl p-8 shadow-xl shadow-black/40 [--foil-fill:#0b0d13]">
        <h1 className="text-xl font-semibold text-white">Welcome back</h1>
        <p className="mt-1 text-sm text-zinc-400">Log in to your CardFlip account.</p>

        <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
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
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={FIELD}
              placeholder="you@example.com"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="text-sm font-medium text-zinc-300">
                Password
              </label>
              <Link
                href="/forgot-password"
                className="text-xs text-zinc-500 transition hover:text-zinc-300"
              >
                Forgot password?
              </Link>
            </div>
            <PasswordField
              id="password"
              name="password"
              autoComplete="current-password"
              enterKeyHint="go"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={FIELD}
              placeholder="••••••••"
            />
          </div>

          {needsCode && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="totp-code" className="text-sm font-medium text-zinc-300">
                Two-step code
              </label>
              <input
                id="totp-code"
                name="totp-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                enterKeyHint="go"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className={`${FIELD} text-center text-lg tracking-[0.4em]`}
                placeholder="123456"
              />
              <p className="text-xs text-zinc-500">
                Open your authenticator app and enter the current 6-digit code for CardFlip.
              </p>
            </div>
          )}

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
            {submitting ? "Logging in…" : "Log in"}
          </button>
        </form>

        <DevLoginButton />

        <p className="mt-6 text-center text-xs text-zinc-500">
          No account?{" "}
          <Link href="/signup" className="text-brand-300 hover:text-brand-200">
            Sign up
          </Link>
          {" "}&middot;{" "}
          {/* The demo backend (api/auth/demo: shared account, wiped and
              reseeded on every entry, eBay-linking refused) had no UI door
              left -- startDemoSession sat exported with zero callers, which
              surfaced as "what's the demo password?" (Chris, 08-28). There
              is no password by design; this button IS the login. */}
          <button
            type="button"
            onClick={() => {
              void startDemoSession()
                .then(() => router.replace("/app"))
                .catch((err) => setError(err instanceof Error ? err.message : "Couldn't start the demo."));
            }}
            className="text-brand-300 underline-offset-4 hover:text-brand-200 hover:underline"
          >
            Try the demo
          </button>
        </p>
      </div>

      <Link
        href="/"
        className="mt-6 text-sm text-zinc-500 transition hover:text-zinc-300"
      >
        ← Back to home
      </Link>
    </div>
  );
}
