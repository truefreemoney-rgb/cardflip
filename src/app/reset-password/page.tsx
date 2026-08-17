"use client";

import PasswordField from "@/components/PasswordField";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Logo from "@/components/Logo";
import Spinner from "@/components/Spinner";
import { apiPath } from "@/lib/client/basePath";

const FIELD =
  "rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-base text-white outline-none sm:text-sm transition placeholder:text-zinc-600 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20";

/**
 * The landing page for a reset link (/reset-password?token=…). Checks the
 * link before asking for a password so an expired one says so up front,
 * then sets the password and signs the seller in.
 */
function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  // No token in the URL is known synchronously — nothing to check.
  const [checking, setChecking] = useState(Boolean(token));
  const [valid, setValid] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(apiPath(`/api/auth/reset?token=${encodeURIComponent(token)}`))
      .then((r) => r.json())
      .then((data: { valid: boolean; email: string | null }) => {
        if (cancelled) return;
        setValid(Boolean(data.valid));
        setEmail(data.email ?? null);
      })
      .catch(() => {
        if (!cancelled) setValid(false);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(apiPath("/api/auth/reset"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? "Couldn't reset the password.");
      router.replace("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reset the password.");
      setSubmitting(false);
    }
  }

  let body: React.ReactNode;
  if (checking) {
    body = (
      <p className="mt-6 flex items-center gap-2 text-sm text-zinc-400">
        <Spinner className="h-4 w-4" /> Checking your link…
      </p>
    );
  } else if (!valid) {
    body = (
      <>
        <p className="mt-3 text-sm leading-relaxed text-zinc-300">
          This reset link is invalid or has expired. Links work once and last an hour.
        </p>
        <Link
          href="/forgot-password"
          className="mt-5 inline-flex rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400"
        >
          Request a new link
        </Link>
      </>
    );
  } else {
    body = (
      <>
        <p className="mt-1 text-sm text-zinc-400">
          Choose a new password{email ? <> for <span className="text-zinc-200">{email}</span></> : null}.
        </p>
        <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium text-zinc-300">
              New password
            </label>
            <PasswordField
              id="password"
              name="password"
              autoComplete="new-password"
              autoFocus
              enterKeyHint="next"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={FIELD}
              placeholder="At least 6 characters"
              hint
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm" className="text-sm font-medium text-zinc-300">
              Confirm password
            </label>
            <PasswordField
              id="confirm"
              name="confirm"
              autoComplete="new-password"
              enterKeyHint="go"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={FIELD}
              placeholder="••••••••"
            />
            {confirm.length > 0 && confirm !== password && (
              <span className="text-[11px] text-amber-300">Doesn&apos;t match yet</span>
            )}
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
            {submitting ? "Saving…" : "Set new password"}
          </button>
        </form>
      </>
    );
  }

  return (
    <div className="foil-edge relative w-full max-w-sm rounded-2xl p-8 shadow-xl shadow-black/40 [--foil-fill:#0b0d13]">
      <h1 className="text-xl font-semibold text-white">New password</h1>
      {body}
      <p className="mt-6 text-center text-xs text-zinc-500">
        <Link href="/login" className="text-brand-300 hover:text-brand-200">
          Back to log in
        </Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="hero-mesh grain relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-4 py-12 text-foreground">
      <div className="relative mb-8">
        <Logo />
      </div>
      {/* useSearchParams needs a Suspense boundary for static rendering. */}
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
      <Link href="/" className="mt-6 text-sm text-zinc-500 transition hover:text-zinc-300">
        ← Back to home
      </Link>
    </div>
  );
}
