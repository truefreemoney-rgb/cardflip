"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiPath } from "@/lib/client/basePath";
import { etTime } from "@/lib/time";
import type { EmailConfirmStats } from "@/lib/server/emailVerify";

/**
 * Email confirmation switch (admin console). Off is how the site ships: new
 * signups go straight in, as before. On, a new signup types a 6-digit code
 * (or taps the button in the mail) before it can scan; existing accounts,
 * subscribers, Booster holders, comped accounts and the owner are never
 * asked. Turning it Off is also the kill switch: everyone still waiting on a
 * code is let in at once (oldest first, so the one-free-trial rule still holds).
 */
export default function EmailConfirmSwitch({ stats: initial }: { stats: EmailConfirmStats }) {
  const router = useRouter();
  const [stats, setStats] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function flip() {
    const next = !stats.on;
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(apiPath("/api/admin/settings"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailConfirm: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't save");
      if (data.emailConfirm) setStats(data.emailConfirm as EmailConfirmStats);
      if (!next && typeof data.released === "number" && data.released > 0) {
        setNote(`${data.released} ${data.released === 1 ? "account" : "accounts"} waiting on a code ${data.released === 1 ? "was" : "were"} let in.`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setPending(false);
    }
  }

  // Confirmation mails are counted per UTC day; say when that day turns over in Eastern.
  const [resets] = useState(() => {
    const t = new Date();
    return etTime(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1));
  });
  // Off and nothing can deliver a code: the switch has nowhere to go.
  const blocked = !stats.on && !stats.deliverable;

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-200">Email confirmation</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {stats.on
              ? "On. A new signup types a 6-digit code before it can scan. Existing accounts, subscribers and Booster holders are never asked."
              : blocked
                ? "Off. Email isn't set up on this server, so codes can't be sent."
                : "Off. New signups go straight in, as before."}
          </p>
        </div>
        <button
          onClick={flip}
          disabled={pending || blocked}
          role="switch"
          aria-checked={stats.on}
          aria-label="Email confirmation on"
          className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${stats.on ? "bg-emerald-500" : "bg-zinc-700"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${stats.on ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>

      {stats.on && (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-edge bg-edge text-xs sm:grid-cols-4">
          <div className="bg-black/30 px-3 py-2">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Waiting for a code</dt>
            <dd className="font-display text-lg font-semibold tabular-nums text-white">{stats.waiting}</dd>
          </div>
          <div className="bg-black/30 px-3 py-2" title={`The count starts over at ${resets} every day.`}>
            <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Sent today</dt>
            <dd className="font-display text-lg font-semibold tabular-nums text-white">
              {stats.sentToday}
              <span className="text-xs font-normal text-zinc-500"> / {stats.dayBudget}</span>
            </dd>
          </div>
          <div className="bg-black/30 px-3 py-2">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Send failures, 24 h</dt>
            <dd className={`font-display text-lg font-semibold tabular-nums ${stats.failedLast24h > 0 ? "text-amber-300" : "text-white"}`}>{stats.failedLast24h}</dd>
          </div>
          <div className="bg-black/30 px-3 py-2">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Bad addresses, 24 h</dt>
            <dd className="font-display text-lg font-semibold tabular-nums text-white">{stats.refusedLast24h}</dd>
          </div>
        </dl>
      )}
      {stats.on && !stats.deliverable && (
        <p className="text-xs text-amber-300">
          The switch is on, but email isn&apos;t set up on this server right now, so nobody is being asked for a code.
        </p>
      )}
      {stats.on && stats.failedLast24h > 0 && (
        <p className="text-xs text-amber-300">
          Our side failed to send {stats.failedLast24h} {stats.failedLast24h === 1 ? "code" : "codes"} in the last 24 hours. Check the mailbox, and see{" "}
          <Link href="/admin/errors" className="underline underline-offset-2 hover:text-amber-200">
            Errors
          </Link>{" "}
          (source email-confirm).
        </p>
      )}
      {stats.on && (
        <p className="text-xs text-zinc-600">
          Sent today starts over at {resets}. Past {stats.dayBudget}, new signups skip the code. Bad addresses are typos the mail server refused; a sudden burst of them is not people.
        </p>
      )}
      {note && <p className="text-xs text-emerald-300">{note}</p>}
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
