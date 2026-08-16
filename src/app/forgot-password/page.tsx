"use client";

import { useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import Spinner from "@/components/Spinner";
import { apiPath } from "@/lib/client/basePath";

const FIELD =
  "rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20";

/**
 * "Forgot password?" — asks for the email and requests a one-time reset link.
 * The server answers the same way whether or not the address is registered;
 * the one distinct state is "this server can't send email yet", which is
 * shown honestly with the support address instead.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Enter the email you signed up with.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(apiPath("/api/auth/forgot"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? "Couldn't send a reset link.");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send a reset link.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="hero-mesh grain relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 py-12 text-foreground">
      <div className="relative mb-8">
        <Logo />
      </div>

      <div className="foil-edge relative w-full max-w-sm rounded-2xl p-8 shadow-xl shadow-black/40 [--foil-fill:#0b0d13]">
        <h1 className="text-xl font-semibold text-white">Reset your password</h1>

        {sent ? (
          <>
            <p className="mt-3 text-sm leading-relaxed text-zinc-300">
              If an account exists for <span className="text-white">{email.trim()}</span>,
              a reset link is on its way. It works once and expires in an hour.
            </p>
            <p className="mt-3 text-xs text-zinc-500">
              Nothing after a few minutes? Check spam, or email{" "}
              <a href="mailto:support@superiormarketing.com" className="text-brand-300 hover:text-brand-200">
                support@superiormarketing.com
              </a>
              .
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-zinc-400">
              Enter your email and we&apos;ll send a one-time reset link.
            </p>
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
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={FIELD}
                  placeholder="you@example.com"
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
                {submitting ? "Sending…" : "Send reset link"}
              </button>
            </form>
          </>
        )}

        <p className="mt-6 text-center text-xs text-zinc-500">
          Remembered it?{" "}
          <Link href="/login" className="text-brand-300 hover:text-brand-200">
            Log in
          </Link>
        </p>
      </div>

      <Link href="/" className="mt-6 text-sm text-zinc-500 transition hover:text-zinc-300">
        ← Back to home
      </Link>
    </div>
  );
}
