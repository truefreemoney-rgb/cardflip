"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client/basePath";
import { useSession } from "@/components/SessionProvider";
import { toast } from "@/components/Toaster";

/** One redeem call; the message to show and whether scans were added. */
export async function redeemCode(code: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await apiFetch("/api/account/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; scans?: number; error?: string } | null;
    if (j?.ok) return { ok: true, message: `${j.scans} free scans added. Go scan something!` };
    return { ok: false, message: j?.error ?? "That code didn't work. Try again in a minute." };
  } catch {
    return { ok: false, message: "That code didn't work. Try again in a minute." };
  }
}

/**
 * The email button lands on /app?code=FLIPBACK (signed out, the login bounce
 * keeps the query). Redeems once the session is ready, then drops the param.
 */
export function PromoCodeFromLink() {
  const { status, refresh } = useSession();
  const done = useRef(false);
  useEffect(() => {
    if (status !== "ready" || done.current) return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (!code) return;
    done.current = true;
    url.searchParams.delete("code");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    void redeemCode(code).then((r) => {
      toast(r.message, r.ok ? "ok" : "info");
      if (r.ok) void refresh();
    });
  }, [status, refresh]);
  return null;
}

/** The Account page's "Have a code?" box. */
export function PromoCodeBox({ onRedeemed }: { onRedeemed?: () => void }) {
  const { refresh } = useSession();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!code.trim() || busy) return;
        setBusy(true);
        const r = await redeemCode(code);
        setBusy(false);
        setNote({ ok: r.ok, text: r.message });
        if (r.ok) {
          setCode("");
          void refresh();
          onRedeemed?.();
        }
      }}
    >
      <label htmlFor="promo-code" className="sr-only">
        Promo code
      </label>
      <div className="flex gap-2">
        <input
          id="promo-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter code"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-base uppercase text-white placeholder:normal-case placeholder:text-zinc-500"
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Adding…" : "Apply"}
        </button>
      </div>
      {note && <p className={`text-sm ${note.ok ? "text-emerald-400" : "text-zinc-400"}`}>{note.text}</p>}
    </form>
  );
}
