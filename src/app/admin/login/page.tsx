"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import Spinner from "@/components/Spinner";
import { apiPath } from "@/lib/client/basePath";

const FIELD =
  "rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-base text-white outline-none sm:text-sm transition placeholder:text-zinc-600 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20";

/** Operator sign-in for the admin console — separate from seller accounts. */
export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError("Enter the admin username and password.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(apiPath("/api/admin/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Sign-in failed.");
      router.replace("/admin");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      setSubmitting(false);
    }
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
        <p className="mt-1 text-sm text-zinc-400">Sign in with the operator credentials.</p>
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
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
      <Link href="/" className="mt-6 text-sm text-zinc-500 transition hover:text-zinc-300">
        ← Back to home
      </Link>
    </div>
  );
}
