"use client";

import { useState } from "react";
import type { SocialComment } from "@/lib/server/socialInbox";

const KIND_LABEL: Record<string, string> = { spam: "Spam", question: "Question", praise: "Praise", other: "Comment" };
const KIND_CLASS: Record<string, string> = {
  spam: "border-red-400/50 text-red-300",
  question: "border-brand-400/60 text-brand-200",
  praise: "border-emerald-400/50 text-emerald-300",
  other: "border-edge text-zinc-300",
};
const STATUS_LABEL: Record<string, string> = { hidden: "Hidden", replied: "Replied", dismissed: "Dismissed", new: "Waiting" };

function when(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

async function call(body: Record<string, unknown>): Promise<{ comment?: SocialComment; draft?: string | null; error?: string }> {
  const res = await fetch("/api/admin/social/inbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { comment?: SocialComment; draft?: string | null; error?: string };
}

function Card({ c, onDone }: { c: SocialComment; onDone: (updated: SocialComment) => void }) {
  const [text, setText] = useState(c.draft ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canHide = c.site !== "bluesky";
  const hideError = typeof c.meta?.hideError === "string" ? c.meta.hideError : null;

  async function act(action: "reply" | "hide" | "dismiss" | "redraft") {
    setBusy(action);
    setError(null);
    const out = await call({ id: c.id, action, text: action === "reply" ? text : undefined });
    setBusy(null);
    if (out.error) {
      setError(out.error);
      return;
    }
    if (action === "redraft") {
      if (out.draft) setText(out.draft);
      else setError("No draft came back");
      return;
    }
    if (out.comment) onDone(out.comment);
  }

  return (
    <div className="rounded-2xl border border-edge bg-white/[0.02] p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-edge px-2 py-0.5 text-zinc-300">{c.site === "x" ? "X" : c.site.charAt(0).toUpperCase() + c.site.slice(1)}</span>
        <span className={`rounded-full border px-2 py-0.5 ${KIND_CLASS[c.kind] ?? KIND_CLASS.other}`}>{KIND_LABEL[c.kind] ?? c.kind}</span>
        {c.meta?.repeatOffender === true && <span className="rounded-full border border-red-400/50 px-2 py-0.5 text-red-300">Repeat spammer</span>}
        <span className="text-zinc-500">{when(c.at)}</span>
        <a href={c.postUrl} target="_blank" rel="noreferrer" className="ml-auto text-zinc-400 underline-offset-2 hover:text-white hover:underline">
          Open post ↗
        </a>
      </div>
      {c.postText && <p className="mb-2 line-clamp-1 text-xs text-zinc-500">On: {c.postText.replace(/\s+/g, " ")}</p>}
      <p className="text-sm text-zinc-200">
        <span className="font-medium text-white">{c.author}</span> <span className="text-zinc-500">said</span> {c.text}
      </p>
      {hideError && <p className="mt-1 text-xs text-amber-300">Could not hide: {hideError}</p>}
      {c.kind !== "spam" || text ? (
        <div className="mt-3">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">Reply</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-edge bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-brand-400/60"
            placeholder="No draft yet. Write one or press Redraft."
          />
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null || !text.trim()}
          onClick={() => act("reply")}
          className="rounded-full bg-brand-500 px-3 py-1 text-sm font-medium text-black hover:bg-brand-400 disabled:opacity-40"
        >
          {busy === "reply" ? "Sending…" : "Send"}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => act("redraft")} className="rounded-full border border-edge px-3 py-1 text-sm text-zinc-300 hover:text-white disabled:opacity-40">
          {busy === "redraft" ? "Drafting…" : "Redraft"}
        </button>
        {canHide && (
          <button type="button" disabled={busy !== null} onClick={() => act("hide")} className="rounded-full border border-red-400/50 px-3 py-1 text-sm text-red-300 hover:text-white disabled:opacity-40">
            {busy === "hide" ? "Hiding…" : "Hide"}
          </button>
        )}
        <button type="button" disabled={busy !== null} onClick={() => act("dismiss")} className="rounded-full border border-edge px-3 py-1 text-sm text-zinc-400 hover:text-white disabled:opacity-40">
          {busy === "dismiss" ? "…" : "Dismiss"}
        </button>
        {error && <span className="self-center text-xs text-amber-300">{error}</span>}
      </div>
    </div>
  );
}

export default function SocialInbox({ waiting: initialWaiting, handled: initialHandled }: { waiting: SocialComment[]; handled: SocialComment[] }) {
  const [waiting, setWaiting] = useState(initialWaiting);
  const [handled, setHandled] = useState(initialHandled);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function done(updated: SocialComment) {
    setWaiting((w) => w.filter((c) => c.id !== updated.id));
    setHandled((h) => [updated, ...h]);
  }

  async function checkNow() {
    setChecking(true);
    setNote(null);
    try {
      const res = await fetch("/api/cron/social-inbox", { cache: "no-store" });
      const j = (await res.json()) as { added?: number; hidden?: number; sites?: Array<{ label: string; error: string | null }>; error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      const errs = (j.sites ?? []).filter((s) => s.error).map((s) => `${s.label}: ${s.error}`);
      setNote(`${j.added ?? 0} new, ${j.hidden ?? 0} spam hidden${errs.length ? ` · ${errs.join(" · ")}` : ""}`);
      const list = await fetch("/api/admin/social/inbox", { cache: "no-store" }).then((r) => r.json() as Promise<{ waiting: SocialComment[]; handled: SocialComment[] }>);
      setWaiting(list.waiting);
      setHandled(list.handled);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={checkNow} disabled={checking} className="rounded-full border border-brand-400/60 px-3 py-1 text-sm text-brand-200 hover:text-white disabled:opacity-40">
          {checking ? "Checking…" : "Check now"}
        </button>
        <span className="text-sm text-zinc-400">
          {waiting.length} waiting
          {note ? ` · ${note}` : ""}
        </span>
      </div>
      {waiting.length === 0 ? (
        <p className="rounded-2xl border border-edge bg-white/[0.02] p-4 text-sm text-zinc-500">Nothing waiting. The next check runs an hour after the next post.</p>
      ) : (
        <div className="space-y-3">
          {waiting.map((c) => (
            <Card key={c.id} c={c} onDone={done} />
          ))}
        </div>
      )}
      {handled.length > 0 && (
        <details className="rounded-2xl border border-edge bg-white/[0.02] p-4">
          <summary className="cursor-pointer text-sm text-zinc-300">Handled · {handled.length}</summary>
          <ul className="mt-2 space-y-2">
            {handled.map((c) => (
              <li key={c.id} className="text-sm text-zinc-400">
                <span className="rounded-full border border-edge px-2 py-0.5 text-xs text-zinc-300">{STATUS_LABEL[c.status] ?? c.status}</span>{" "}
                <span className="text-zinc-500">{c.site === "x" ? "X" : c.site.charAt(0).toUpperCase() + c.site.slice(1)} · {when(c.at)}</span> <span className="text-zinc-300">{c.author}</span>: {c.text}
                {c.replyText && <span className="block pl-3 text-zinc-500">↳ {c.replyText}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
