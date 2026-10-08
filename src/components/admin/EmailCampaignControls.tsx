"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPath } from "@/lib/client/basePath";

/** The weekly mails (/admin/emails): the on/off switch, a per-mail Send Now, and per-version test sends to the owner. */

async function call(method: "PATCH" | "POST", body: object) {
  const res = await fetch(apiPath("/api/admin/emails"), {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Couldn't do that");
  return data;
}

export default function EmailCampaignControls({ on: initial }: { on: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flip = async () => {
    setPending(true);
    setError(null);
    try {
      const data = await call("PATCH", { on: !on });
      setOn(Boolean(data.on));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't do that");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-2 rounded-2xl border border-edge bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-200">Weekly emails</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {on ? "On. Mails go out at their send times." : "Off. Nothing goes to users. Test sends to you still work."}
          </p>
        </div>
        <button
          onClick={flip}
          disabled={pending}
          role="switch"
          aria-checked={on}
          aria-label="Weekly emails on"
          className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${on ? "bg-emerald-500" : "bg-zinc-700"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${on ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    </div>
  );
}

/** Sends one mail to everyone due now (the switch must be on). */
export function SendNowButton({ id, label, on }: { id: string; label: string; on: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!on) return null;
  const send = async () => {
    if (!window.confirm(`Send "${label}" to everyone due now?`)) return;
    setPending(true);
    setNote(null);
    try {
      const r = await call("POST", { runNow: id });
      setNote(r.skipped ? `Nothing sent: ${r.skipped}.` : `Sent ${r.sent} of ${r.due}${r.failed ? `, ${r.failed} failed` : ""}.`);
      router.refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't send");
    } finally {
      setPending(false);
    }
  };
  return (
    <span className="flex items-center gap-2">
      {note && <span className="text-xs text-zinc-300">{note}</span>}
      <button onClick={send} disabled={pending} className="rounded-full border border-amber-400/40 px-3 py-1 text-sm text-amber-200 hover:text-white disabled:opacity-50">
        Send Now
      </button>
    </span>
  );
}

export function EmailTestButton({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setState("sending");
    setError(null);
    try {
      await call("POST", { test: id });
      setState("sent");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send");
      setState("error");
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-300">{error}</span>}
      <button onClick={send} disabled={state === "sending"} className="rounded-full border border-edge px-3 py-1 text-sm text-zinc-200 hover:text-white disabled:opacity-50">
        {state === "sending" ? "Sending…" : state === "sent" ? "Sent To You" : "Send Test To Me"}
      </button>
    </div>
  );
}
