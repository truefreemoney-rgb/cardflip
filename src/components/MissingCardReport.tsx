"use client";

import { useState } from "react";
import Spinner from "@/components/Spinner";
import { GAMES } from "@/lib/games";
import { apiPath } from "@/lib/client/basePath";
import type { GameId } from "@/lib/types";

interface Props {
  game: GameId;
  /** What the seller typed in the search box, if anything. */
  typed?: string;
  /** What the scanner read off the photo (name, set, number), if anything. */
  read?: { name?: string | null; setName?: string | null; number?: string | null } | null;
}

/**
 * "Card Missing? Tell Us" on a catalog miss. Opens a support ticket through
 * the same route the Help robot uses (POST /api/help/tickets); the subject
 * starts "Missing Card:" so /admin/support shows it as a missing-card report.
 * "Email me when it's added" is a line in the ticket for now: the notify
 * email is sent by hand from the admin reply.
 */
export default function MissingCardReport({ game, typed = "", read = null }: Props) {
  const [open, setOpen] = useState(false);
  const [guess, setGuess] = useState("");
  const [notify, setNotify] = useState(true);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readLine = [read?.name, read?.setName, read?.number ? `#${read.number}` : null].filter(Boolean).join(" · ");
  const label = typed.trim() || readLine || "Unknown Card";

  async function send() {
    if (sending) return;
    setSending(true);
    setError(null);
    const lines = [
      `Game: ${GAMES[game].label}`,
      `Typed: ${typed.trim() || "(nothing)"}`,
      `Read from photo: ${readLine || "(nothing)"}`,
      `Set / number guess: ${guess.trim() || "(none)"}`,
      `Email when added: ${notify ? "YES, reply to this ticket when it is in" : "No"}`,
    ];
    try {
      const res = await fetch(apiPath("/api/help/tickets"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: `Missing Card: ${label}`.slice(0, 80), message: lines.join("\n") }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(
        res.status === 401
          ? "Sign in to send a report."
          : typeof data?.error === "string" && data.error
            ? data.error
            : "Couldn't send that. Try again in a minute.",
      );
    } catch {
      setError("Couldn't send that. Check your connection.");
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <p role="status" className="text-xs font-medium text-emerald-400">
        Thanks, we got it.{notify ? " We'll email you when it's added." : ""}
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-brand-300 underline underline-offset-2 hover:text-brand-200">
        Card Missing? Tell Us
      </button>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-2 rounded-xl border border-edge bg-black/30 p-3 text-left">
      <p className="text-sm font-semibold text-white">Card Missing? Tell Us</p>
      <p className="text-xs text-zinc-400">
        {GAMES[game].label} · {label}
      </p>
      <input
        value={guess}
        onChange={(e) => setGuess(e.target.value)}
        maxLength={120}
        aria-label="Set and number, if you know them"
        placeholder="Set and number, if you know them"
        className="rounded-lg border border-edge bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-brand-400"
      />
      <label className="flex items-center gap-2 text-xs text-zinc-300">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4" />
        Email me when it&apos;s added
      </label>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending}
          className="flex items-center gap-2 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-60"
        >
          {sending && <Spinner className="h-3.5 w-3.5" />}
          Send Report
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-full border border-edge px-3 py-2 text-sm text-zinc-300 transition hover:border-edge-strong">
          Cancel
        </button>
      </div>
    </div>
  );
}
