"use client";

import { useState } from "react";
import Spinner from "@/components/Spinner";

const FIELD =
  "w-full rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-base text-white outline-none sm:text-sm transition placeholder:text-zinc-600 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20";

/** The /unavailable email box → POST /api/waitlist (country is read server-side). */
export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot: people never see it
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Enter your email.");
      return;
    }
    setState("sending");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), website }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Something went wrong. Try again.");
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <p role="status" className="mt-5 rounded-lg bg-brand-500/10 px-3 py-3 text-sm font-medium text-brand-200">
        You&apos;re on the list. We&apos;ll email you once, when CardFlip opens in your country.
      </p>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="mt-5 flex flex-col gap-3">
      <label htmlFor="waitlist-email" className="sr-only">
        Email
      </label>
      <input
        id="waitlist-email"
        type="email"
        autoComplete="email"
        inputMode="email"
        enterKeyHint="send"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={FIELD}
        placeholder="you@example.com"
      />
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />
      {error && (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={state === "sending"}
        className="flex items-center justify-center gap-2 rounded-full bg-brand-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-400 disabled:opacity-60"
      >
        {state === "sending" && <Spinner className="h-4 w-4" />}
        {state === "sending" ? "Sending…" : "Email Me"}
      </button>
    </form>
  );
}
