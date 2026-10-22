"use client";

import { useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import Spinner from "@/components/Spinner";
import { apiPath } from "@/lib/client/basePath";
import { useResendGap } from "@/lib/client/resendGap";
import { TAP_LINK } from "@/lib/tap";

const FIELD =
  "rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-base text-white outline-none sm:text-sm transition placeholder:text-zinc-600 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20";

/** Operator sign-in for the admin console — separate from seller accounts. */
export default function AdminLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The owner's login gets a 6-digit code by email (lib/server/loginCode.ts); the server says where it went.
  const [code, setCode] = useState("");
  const [mailedTo, setMailedTo] = useState<string | null>(null);
  const resendGap = useResendGap();

  /** `withCode` false = the password alone: the first step, and Send a New Code. */
  async function signIn(withCode: boolean) {
    setError(null);
    if (!username.trim() || !password) {
      setError("Enter the admin username and password.");
      return;
    }
    if (withCode && !/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(apiPath("/api/admin/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password, ...(withCode ? { code: code.trim() } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // Full page load, not router.replace: the router can reuse an /admin it fetched before the
        // cookie existed (a redirect to this page), which looped Chris back here after a good sign-in (10-17).
        window.location.replace(apiPath("/admin"));
        return;
      }
      if (data.codeRequired) {
        // Password was right. A code just mailed is a prompt, not an error; only a wrong code reads as one.
        if (withCode) setError(data.error ?? "That code didn't match.");
        else {
          setMailedTo(data.error ?? "We emailed you a 6-digit code.");
          resendGap.start();
        }
        setCode("");
      } else {
        setError(data.error ?? "Sign-in failed.");
      }
    } catch {
      setError("Sign-in failed.");
    }
    setSubmitting(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void signIn(mailedTo !== null);
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface-1 p-8 shadow-xl shadow-black/40">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-white">Admin console</h1>
          <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[11px] font-medium text-brand-300">operator</span>
        </div>
        <p className="mt-1 text-sm text-zinc-400">Log in with the operator credentials.</p>
        <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="admin-user" className="text-sm font-medium text-zinc-300">Username</label>
            <input
              id="admin-user"
              name="username"
              type="text"
              autoComplete="username"
              autoFocus
              required
              enterKeyHint="next"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={FIELD}
              placeholder="admin"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="admin-pass" className="text-sm font-medium text-zinc-300">Password</label>
            <input
              id="admin-pass"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              enterKeyHint="go"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={FIELD}
              placeholder="••••••••"
            />
          </div>
          {mailedTo && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="admin-code" className="text-sm font-medium text-zinc-300">Sign-In Code</label>
              <input
                id="admin-code"
                name="code"
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
              <p className="text-xs text-zinc-500">{mailedTo}</p>
              {/* Full-size button (Chris 10-13): the inline text link was easy to miss. */}
              <button
                type="button"
                onClick={() => void signIn(false)}
                disabled={submitting || resendGap.left > 0}
                className="mt-1 w-full rounded-full border border-edge px-5 py-2.5 text-sm font-semibold text-zinc-200 transition hover:border-edge-strong hover:text-white disabled:opacity-60"
              >
                {resendGap.left > 0 ? `Send a New Code (${resendGap.left}s)` : "Send a New Code"}
              </button>
            </div>
          )}
          <p role="alert" aria-live="polite" className="min-h-0">
            {error && (
              <span className="block rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400">{error}</span>
            )}
          </p>
          <button
            type="submit"
            disabled={submitting}
            className="mt-1 flex items-center justify-center gap-2 rounded-full bg-brand-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-400 disabled:opacity-60"
          >
            {submitting && <Spinner className="h-4 w-4" />}
            {submitting ? "Logging in…" : "Log In"}
          </button>
        </form>
      </div>
      <Link href="/" className={`${TAP_LINK} mt-6 text-sm text-zinc-400 transition hover:text-zinc-200`}>
        ← Back to home
      </Link>
    </div>
  );
}
