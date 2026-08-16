"use client";

import { useState } from "react";
import { apiPath } from "@/lib/client/basePath";

interface Props {
  userId: string;
  /** The demo account has no password — no button. */
  disabled?: boolean;
}

/**
 * Admin password reset: mints a one-time link and shows it once, to copy and
 * hand to the user. When SMTP is configured the server also emails it. The
 * link never persists in clear — closing this loses it, which is the point.
 */
export default function ResetLinkButton({ userId, disabled }: Props) {
  const [pending, setPending] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(apiPath(`/api/admin/users/${userId}/reset-link`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ send: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't create a reset link.");
      setLink(data.url);
      setEmailed(Boolean(data.emailed));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create a reset link.");
    } finally {
      setPending(false);
    }
  }

  function copy() {
    if (!link) return;
    navigator.clipboard
      .writeText(link)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => window.prompt("Copy the reset link:", link));
  }

  if (disabled) return <span className="text-zinc-600">—</span>;

  if (link) {
    return (
      <div className="flex max-w-xs flex-col gap-1">
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="w-44 truncate rounded-md border border-edge bg-black/40 px-2 py-1 text-[11px] text-zinc-300"
          />
          <button
            onClick={copy}
            className="rounded-full bg-white/5 px-2.5 py-1 text-xs font-medium text-zinc-300 transition hover:bg-white/10"
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <button
            onClick={() => setLink(null)}
            aria-label="Hide reset link"
            className="text-xs text-zinc-600 hover:text-zinc-400"
          >
            ✕
          </button>
        </div>
        <span className="text-[10px] text-zinc-600">
          {emailed ? "Emailed to the user too. " : ""}One use, expires in 1 hour.
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-[11px] text-red-400">{error}</span>}
      <button
        onClick={issue}
        disabled={pending}
        className="rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-zinc-400 transition hover:bg-white/10 disabled:opacity-40"
      >
        {pending ? "…" : "Reset password"}
      </button>
    </div>
  );
}
