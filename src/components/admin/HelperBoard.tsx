"use client";

import { useCallback, useEffect, useState } from "react";
import type { BoardItem, BoardSection } from "@/lib/server/board";
import type { RunStatus } from "@/lib/server/boardRuns";
import { apiPath } from "@/lib/client/basePath";
import { GHOST, INPUT, PRIMARY, PhotoButton, RUN_CHIP, RunPanel, RunsContext, Thumbs, noteLines, since } from "@/components/admin/AdminBoard";

/**
 * The Tasks page a helper sees (lib/adminAuth.ts helper role — Chris, 09-10:
 * "put some training wheels on so she doesn't break everything, help her as
 * much as possible to get her done and out of here"). One category, hers;
 * four things to do: write a note, add a photo, ▶ Run, ↳ Reply. Every write
 * goes through /api/admin/board/note, which re-reads the board server-side,
 * so nothing else on the board can be touched from here. No Merge: a
 * finished run waits for Chris.
 */
export default function HelperBoard({ sections: initial, name }: { sections: BoardSection[]; name: string }) {
  const [sections, setSections] = useState<BoardSection[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<number, RunStatus>>({});
  const [draft, setDraft] = useState("");
  const [draftImages, setDraftImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const title = `${name}'s thoughts`;
  const mine = sections.find((s) => s.title === title);
  const items = mine?.items ?? [];

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch(apiPath("/api/admin/board/runs"), { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.runs) setRuns(data.runs as Record<number, RunStatus>);
    } catch {
      /* chips fall back to Running */
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRuns();
  }, [loadRuns]);
  const moving = Object.values(runs).some((r) => r.state === "running" || r.state === "pr-ready");
  useEffect(() => {
    const tick = () => { if (typeof document === "undefined" || document.visibilityState === "visible") void loadRuns(); };
    const id = setInterval(tick, moving ? 20_000 : 120_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [loadRuns, moving]);

  async function post(path: string, body: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiPath(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "That didn't work");
      if (data.sections) setSections(data.sections as BoardSection[]);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!draft.trim() && draftImages.length === 0) return;
    if (await post("/api/admin/board/note", { text: draft, images: draftImages })) {
      setDraft("");
      setDraftImages([]);
    }
  }

  return (
    <RunsContext.Provider value={{ runs, reload: loadRuns }}>
      <div className="space-y-4">
        <div className="rounded-xl border border-brand-400/30 bg-brand-500/10 px-4 py-3 text-[13px] leading-relaxed text-zinc-200">
          <p className="font-semibold text-white">Hi {name} — this page is yours.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-zinc-300">
            <li>Write what you want done in the box below, plain words. Add a photo if it helps.</li>
            <li>Press <span className="font-semibold text-white">▶ Run</span>. A robot reads the note and works on it (a few minutes to an hour).</li>
            <li>Its answer appears under your note. If it asks a question, use <span className="font-semibold text-white">↳ Reply</span>, then ▶ Run again.</li>
            <li>Anything that changes the website waits for Chris to approve. You can&apos;t break anything from here.</li>
          </ol>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-200">{error}</p>
        )}

        <section className="rounded-xl border border-edge bg-surface-1 p-3 sm:p-4">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {items.length === 0 && <p className="mt-2 text-[13px] text-zinc-500">No notes yet — your first one goes in the box below.</p>}
          <ul className="mt-2 space-y-2">
            {items.map((it) => (
              <NoteRow key={it.id} item={it} runs={runs} busy={busy} onError={setError} onRun={() => post("/api/admin/board/run", { id: it.id }).then(() => loadRuns())} onReply={(text, images) => post("/api/admin/board/note", { replyTo: it.id, text, images })} />
            ))}
          </ul>
          <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              maxLength={800}
              placeholder="What do you want done? e.g. Write 5 Instagram captions for the scanner video"
              aria-label="New note"
              className={`${INPUT} w-full resize-none py-2`}
            />
            <Thumbs urls={draftImages} onRemove={(u) => setDraftImages((v) => v.filter((x) => x !== u))} />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={add} disabled={busy || (!draft.trim() && draftImages.length === 0)} className={`${PRIMARY} h-9 px-4 text-sm disabled:opacity-50`}>
                Add note
              </button>
              <PhotoButton count={draftImages.length} onAdd={(urls) => setDraftImages((v) => [...v, ...urls].slice(0, 6))} onError={setError} className="h-9 text-xs" />
            </div>
          </div>
        </section>
      </div>
    </RunsContext.Provider>
  );
}

function NoteRow({ item: it, runs, busy, onError, onRun, onReply }: {
  item: BoardItem;
  runs: Record<number, RunStatus>;
  busy: boolean;
  onError: (m: string) => void;
  onRun: () => void;
  onReply: (text: string, images: string[]) => Promise<boolean>;
}) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [replyImages, setReplyImages] = useState<string[]>([]);
  const m = /^▶ RUNNING #(\d+) — ([\s\S]*)$/.exec(it.text);
  const st = m ? runs[Number(m[1])] : undefined;
  const { head, replies } = noteLines(m ? m[2] : it.text);
  const canRun = !m || (st != null && st.state !== "running");
  const chip = m ? RUN_CHIP[st?.state ?? "running"] : null;
  return (
    <li className="rounded-lg border border-white/5 bg-black/20 px-3 py-2.5 text-[13px] leading-snug">
      <p className="text-zinc-200">
        {m && chip && (
          <a href={st?.url ?? `https://github.com/truefreemoney-rgb/cardflip/issues/${m[1]}`} target="_blank" rel="noreferrer" title={chip.hint} className={`mr-1.5 rounded px-1.5 py-px text-[11px] font-semibold ${chip.cls}`}>
            {chip.label}{st ? ` · ${since(st.startedAt)}` : ""}
          </a>
        )}
        {head}
      </p>
      {replies.map((r, i) => <p key={i} className="mt-1 pl-3 text-zinc-400">{r}</p>)}
      <Thumbs urls={it.images ?? []} onRemove={() => onError("Photos on a saved note stay — add a new note instead")} />
      {st && <RunPanel st={st} onError={onError} onReply={() => setReplying(true)} canMerge={false} />}
      {replying ? (
        <div className="mt-2 space-y-2">
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} maxLength={400} autoFocus placeholder="Your reply" aria-label="Reply" className={`${INPUT} w-full resize-none py-1.5`} />
          <Thumbs urls={replyImages} onRemove={(u) => setReplyImages((v) => v.filter((x) => x !== u))} />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || (!reply.trim() && replyImages.length === 0)} onClick={async () => { if (await onReply(reply, replyImages)) { setReply(""); setReplyImages([]); setReplying(false); } }} className={`${PRIMARY} h-8 px-3 text-xs disabled:opacity-50`}>Send reply</button>
            <PhotoButton count={replyImages.length} onAdd={(urls) => setReplyImages((v) => [...v, ...urls].slice(0, 6))} onError={onError} className="h-8 text-xs" compact />
            <button type="button" onClick={() => setReplying(false)} className={`${GHOST} h-8 px-3 text-xs`}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {canRun && (
            <button type="button" disabled={busy} onClick={onRun} className={`${PRIMARY} h-8 px-3 text-xs disabled:opacity-50`}>{m ? "▶ Run again" : "▶ Run"}</button>
          )}
          {!st && <button type="button" onClick={() => setReplying(true)} className={`${GHOST} h-8 px-3 text-xs`}>↳ Reply</button>}
        </div>
      )}
    </li>
  );
}
