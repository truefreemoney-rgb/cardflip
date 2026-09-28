"use client";

import { useState } from "react";
import type { SocialComment } from "@/lib/server/socialInbox";
import { siteLabel, whenET } from "@/lib/socialPosts";

/**
 * One comment on one of our posts (/admin/social/posts). Waiting ones carry
 * the drafted reply and the four actions — Send, Redraft, Hide, Dismiss;
 * handled ones are a single quiet line. Actions go through
 * /api/admin/social/inbox and hand the updated row back up.
 */

const KIND_LABEL: Record<string, string> = { spam: "Spam", question: "Question", praise: "Praise", other: "Comment" };
const KIND_CLASS: Record<string, string> = {
  spam: "border-red-400/50 text-red-300",
  question: "border-brand-400/60 text-brand-200",
  praise: "border-emerald-400/50 text-emerald-300",
  other: "border-edge text-zinc-300",
};
const STATUS_LABEL: Record<string, string> = { hidden: "Hidden", replied: "Replied", dismissed: "Dismissed", new: "Waiting" };

async function call(body: Record<string, unknown>): Promise<{ comment?: SocialComment; draft?: string | null; error?: string }> {
  const res = await fetch("/api/admin/social/inbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { comment?: SocialComment; draft?: string | null; error?: string };
}

export function HandledComment({ c }: { c: SocialComment }) {
  return (
    <li className="text-sm text-zinc-400">
      <span className="rounded-full border border-edge px-2 py-0.5 text-xs text-zinc-300">{STATUS_LABEL[c.status] ?? c.status}</span>{" "}
      <span className="text-zinc-500">{whenET(c.at)}</span> <span className="text-zinc-300">{c.author}</span>: {c.text}
      {c.replyText && <span className="block pl-3 text-zinc-500">↳ {c.replyText}</span>}
    </li>
  );
}

export default function SocialCommentCard({ c, showSite = false, onDone }: { c: SocialComment; showSite?: boolean; onDone: (updated: SocialComment) => void }) {
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
    <div className="rounded-xl border border-edge bg-black/20 p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
        {showSite && <span className="rounded-full border border-edge px-2 py-0.5 text-zinc-300">{siteLabel(c.site)}</span>}
        <span className={`rounded-full border px-2 py-0.5 ${KIND_CLASS[c.kind] ?? KIND_CLASS.other}`}>{KIND_LABEL[c.kind] ?? c.kind}</span>
        {c.meta?.repeatOffender === true && <span className="rounded-full border border-red-400/50 px-2 py-0.5 text-red-300">Repeat spammer</span>}
        <span className="text-zinc-500">{whenET(c.at)}</span>
        {showSite && (
          <a href={c.postUrl} target="_blank" rel="noreferrer" className="ml-auto text-zinc-400 underline-offset-2 hover:text-white hover:underline">
            Open Post ↗
          </a>
        )}
      </div>
      {showSite && c.postText && <p className="mb-2 line-clamp-1 text-xs text-zinc-500">On: {c.postText.replace(/\s+/g, " ")}</p>}
      <p className="text-sm text-zinc-200">
        <span className="font-medium text-white">{c.author}</span> <span className="text-zinc-500">said</span> {c.text}
      </p>
      {hideError && <p className="mt-1 text-xs text-amber-300">Could not hide: {hideError}</p>}
      {c.kind !== "spam" || text ? (
        <div className="mt-2">
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
