"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPath } from "@/lib/client/basePath";
import { etDate } from "@/lib/time";

interface Props {
  userId: string;
  /** Waiting for the emailed code right now. */
  pending: boolean;
  /** When the inbox was proven; null = never (accounts from before confirmation, or let in without a code). */
  verifiedAt: number | null;
}

/**
 * Admin: where an account stands on email confirmation, and Mark Confirmed for
 * a support ticket where the code never arrived. Owner-trusted (the address is
 * stamped as proven) and it sends no welcome mail, since the address may be
 * exactly what was wrong.
 */
export default function MarkConfirmedButton({ userId, pending, verifiedAt }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mark() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiPath(`/api/admin/users/${userId}/verify-email`), { method: "PATCH" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't mark it confirmed.");
      if (data.changed === false) setError("That account wasn't waiting any more.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't mark it confirmed.");
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-amber-300">Waiting for Code</span>
        {error && <span className="text-[11px] text-red-400">{error}</span>}
        <button
          onClick={mark}
          disabled={busy}
          className="rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-zinc-400 transition hover:bg-white/10 disabled:opacity-40"
        >
          {busy ? "…" : "Mark Confirmed"}
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-400">{verifiedAt ? `Confirmed ${etDate(verifiedAt)}` : "—"}</span>
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </div>
  );
}
