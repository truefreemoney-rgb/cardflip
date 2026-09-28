"use client";

import { useState } from "react";
import type { SocialComment } from "@/lib/server/socialInbox";
import { siteLabel, whenET } from "@/lib/socialPosts";

/**
 * One comment on one of our posts (/admin/social/posts). The robot answers
 * most things itself (lib/socialModeration.ts replyPlan); what reaches
 * Chris is a held one — heated, capped, or a failed send — with the reply
 * editor and Send / Redraft / Hide / Dismiss / Block. Handled ones are a
 * quiet line; a robot reply carries Undo, which deletes it on the platform.
 * Actions go through /api/admin/social/inbox and hand the updated row up.
 */

const KIND_LABEL: Record<string, string> = { spam: "Spam", question: "Question", praise: "Praise", other: "Comment" };
const KIND_CLASS: Record<string, string> = {
  spam: "border-red-400/50 text-red-300",
  question: "border-brand-400/60 text-brand-200",
  praise: "border-emerald-400/50 text-emerald-300",
  other: "border-edge text-zinc-300",
};
const STATUS_LABEL: Record<string, string> = { hidden: "Hidden", replied: "Replied", dismissed: "Dismissed", new: "Waiting" };

type Action = "reply" | "hide" | "dismiss" | "redraft" | "undo" | "block";

async function call(body: Record<string, unknown>): Promise<{ comment?: SocialComment; draft?: string | null; error?: string }> {
  const res = await fetch("/api/admin/social/inbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { comment?: SocialComment; draft?: string | null; error?: string };
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function HandledComment({ c, onDone }: { c: SocialComment; onDone?: (updated: SocialComment) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const robot = c.status === "replied" && c.meta?.auto === true;
  const label = robot ? "Answered by the robot" : c.meta?.undone ? "Reply taken down" : (STATUS_LABEL[c.status] ?? c.status);
  const canUndo = c.status === "replied" && Boolean(str(c.meta?.replyId)) && onDone;

  async function undo() {
    if (!onDone) return;
    setBusy(true);
    setError(null);
    const out = await call({ id: c.id, action: "undo" });
    setBusy(false);
    if (out.error) setError(out.error);
    else if (out.comment) onDone(out.comment);
  }

  return (
    <li className="text-sm text-zinc-400">
      <span className="rounded-full border border-edge px-2 py-0.5 text-xs text-zinc-300">{label}</span>{" "}
      {c.meta?.blocked === true && <span className="rounded-full border border-red-400/50 px-2 py-0.5 text-xs text-red-300">Blocked</span>}{" "}
      <span className="text-zinc-500">{whenET(c.at)}</span> <span className="text-zinc-300">{c.author}</span>: {c.text}
      {c.replyText && (
        <span className="block pl-3 text-zinc-500">
          ↳ {c.replyText}
          {canUndo && (
            <button type="button" disabled={busy} onClick={undo} className="ml-2 rounded-full border border-edge px-2 py-0 text-xs text-zinc-400 hover:text-white disabled:opacity-40">
              {busy ? "…" : "Undo"}
            </button>
          )}
          {error && <span className="ml-2 text-xs text-amber-300">{error}</span>}
        </span>
      )}
      {str(c.meta?.undone) && <span className="block pl-3 text-zinc-600 line-through">↳ {str(c.meta?.undone)}</span>}
    </li>
  );
}

export default function SocialCommentCard({ c, showSite = false, onDone }: { c: SocialComment; showSite?: boolean; onDone: (updated: SocialComment) => void }) {
  const [text, setText] = useState(c.draft ?? "");
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canHide = c.site !== "bluesky";
  const canBlock = c.kind === "spam" && Boolean(c.authorId) && c.meta?.blocked !== true && (c.site === "bluesky" || c.site === "x" || c.site === "facebook");
  const hideError = str(c.meta?.hideError);
  const sendError = str(c.meta?.sendError);
  const holdReason = str(c.meta?.holdReason);
  const needsYou = c.meta?.needsYou === true;

  async function act(action: Action) {
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

  const btn = "rounded-full border px-3 py-1 text-sm hover:text-white disabled:opacity-40";
  return (
    <div className="rounded-xl border border-edge bg-black/20 p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
        {showSite && <span className="rounded-full border border-edge px-2 py-0.5 text-zinc-300">{siteLabel(c.site)}</span>}
        <span className={`rounded-full border px-2 py-0.5 ${KIND_CLASS[c.kind] ?? KIND_CLASS.other}`}>{KIND_LABEL[c.kind] ?? c.kind}</span>
        {c.meta?.repeatOffender === true && <span className="rounded-full border border-red-400/50 px-2 py-0.5 text-red-300">Repeat spammer</span>}
        {needsYou && <span className="rounded-full border border-amber-400/60 px-2 py-0.5 text-amber-300">Needs You</span>}
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
      {sendError && <p className="mt-1 text-xs text-amber-300">Could not send the reply: {sendError}</p>}
      {needsYou && holdReason && <p className="mt-1 text-xs text-zinc-500">Held because {holdReason}. Answer in your own words, or dismiss.</p>}
      {c.kind !== "spam" && (
        <div className="mt-2">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">Reply</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-edge bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-brand-400/60"
            placeholder="Write a reply, or press Redraft for a suggestion."
          />
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {c.kind !== "spam" && (
          <>
            <button type="button" disabled={busy !== null || !text.trim()} onClick={() => act("reply")} className="rounded-full bg-brand-500 px-3 py-1 text-sm font-medium text-black hover:bg-brand-400 disabled:opacity-40">
              {busy === "reply" ? "Sending…" : "Send"}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => act("redraft")} className={`${btn} border-edge text-zinc-300`}>
              {busy === "redraft" ? "Drafting…" : "Redraft"}
            </button>
          </>
        )}
        {canHide && (
          <button type="button" disabled={busy !== null} onClick={() => act("hide")} className={`${btn} border-red-400/50 text-red-300`}>
            {busy === "hide" ? "Hiding…" : "Hide"}
          </button>
        )}
        {canBlock && (
          <button type="button" disabled={busy !== null} onClick={() => act("block")} className={`${btn} border-red-400/50 text-red-300`}>
            {busy === "block" ? "Blocking…" : "Block"}
          </button>
        )}
        <button type="button" disabled={busy !== null} onClick={() => act("dismiss")} className={`${btn} border-edge text-zinc-400`}>
          {busy === "dismiss" ? "…" : "Dismiss"}
        </button>
        {error && <span className="self-center text-xs text-amber-300">{error}</span>}
      </div>
    </div>
  );
}
