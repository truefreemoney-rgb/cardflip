"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";
import { afterLoginPath, login } from "@/lib/client/auth";

// One-click sign-in as the admin account, so Chris doesn't have to type
// credentials every time he checks something.
//
// Shown automatically in development. On a deployed site it only appears when
// NEXT_PUBLIC_DEV_LOGIN=1 is set — it is deliberately opt-in there, because it
// puts an admin session one click away for anyone who loads the page. Unset the
// variable (and redeploy) to take it off the live site.
const ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_DEV_LOGIN === "1";

// The login route aliases the bare username "admin" to admin@cardflip.dev.
const DEV_EMAIL = process.env.NEXT_PUBLIC_DEV_LOGIN_EMAIL ?? "admin";
const DEV_PASSWORD = process.env.NEXT_PUBLIC_DEV_LOGIN_PASSWORD ?? "password";

export default function DevLoginButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ENABLED) return null;

  async function handleClick() {
    setError(null);
    setBusy(true);
    try {
      await login(DEV_EMAIL, DEV_PASSWORD);
      router.replace(afterLoginPath());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dev login failed.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-edge" />
        <span className="text-[10px] uppercase tracking-widest text-zinc-600">dev</span>
        <span className="h-px flex-1 bg-edge" />
      </div>

      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-edge bg-black/30 px-5 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-brand-400 hover:text-white disabled:opacity-60"
      >
        {busy && <Spinner className="h-4 w-4" />}
        {busy ? "Signing in…" : "Log in as admin"}
      </button>

      {error && (
        <p role="alert" className="mt-2 text-center text-xs font-medium text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
