"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { BoardItem, BoardOwner, BoardSection } from "@/lib/server/board";
import { apiPath } from "@/lib/client/basePath";
import { ownerLabel } from "@/components/admin/format";
import type { RunStatus } from "@/lib/server/boardRuns";

/** Run outcomes by issue number, read once per visit (GET /api/admin/board/runs), plus a way to re-read them. */
const RunsContext = createContext<{ runs: Record<number, RunStatus>; reload: () => void }>({ runs: {}, reload: () => {} });
const RUN_CHIP: Record<RunStatus["state"], { label: string; cls: string; hint: string }> = {
  running: { label: "▶ Running", cls: "bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25", hint: "The cloud runner has it — opens the GitHub issue" },
  "needs-you": { label: "? Needs you", cls: "bg-amber-400/20 text-amber-200 hover:bg-amber-400/30", hint: "The runner asked a question — it is shown below" },
  "pr-ready": { label: "✓ PR ready", cls: "bg-sky-400/20 text-sky-200 hover:bg-sky-400/30", hint: "Read the summary below and press Merge" },
  done: { label: "✓ Merged", cls: "bg-emerald-400/25 text-emerald-100 hover:bg-emerald-400/35", hint: "Merged — tick the task when you have seen it live" },
  closed: { label: "✕ Closed", cls: "bg-zinc-700/60 text-zinc-300 hover:bg-zinc-700", hint: "The issue was closed without a merge" },
};

/**
 * The whole run loop on this page (Chris, 09-09: "I don't want things
 * interconnected — everything on cardflip"): the runner's reading of the
 * task, its question if it has one, the PR in plain words, a Merge button,
 * and whether the merge has reached cardflip.io yet. GitHub stays a ↗ link.
 */
function RunPanel({ st, onError, onReply }: { st: RunStatus; onError: (m: string) => void; onReply: () => void }) {
  const { reload } = useContext(RunsContext);
  const [merging, setMerging] = useState(false);
  // The bullet list + screenshots fold away by default: on a phone the
  // panel was a wall of 12px text Chris "can't read" (09-10).
  const [open, setOpen] = useState(false);
  const pr = st.pr;
  async function merge() {
    if (!pr) return;
    setMerging(true);
    try {
      const res = await fetch(apiPath("/api/admin/board/merge"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ number: pr.number }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't merge");
      reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't merge");
    } finally {
      setMerging(false);
    }
  }
  const deploy =
    st.state === "done"
      ? st.deploy === "ready"
        ? { text: "Live on cardflip.io — reload the app to see it", cls: "text-emerald-300" }
        : st.deploy === "failed"
          ? { text: "Merged, but the build failed — tell Claude", cls: "text-red-300" }
          : { text: "Merged · deploying, about 3 minutes", cls: "text-zinc-400" }
      : null;
  if (!st.reading && !st.question && !pr && !deploy) return null;
  const hasDetails = Boolean(pr && (pr.summary.length > 0 || pr.images.length > 0));
  return (
    <div className="mt-1.5 space-y-2 rounded-lg border border-white/5 bg-black/20 px-3 py-2.5 text-[13px] leading-relaxed sm:text-[12px] sm:leading-snug">
      {st.reading && (
        <p className="text-zinc-300">
          <span className="text-zinc-500">Reading this as: </span>
          {st.reading}
        </p>
      )}
      {st.question && (
        <p className="text-amber-200">
          <span className="text-amber-400/80">Needs you: </span>
          {st.question}{" "}
          <a href={st.url} target="_blank" rel="noreferrer" className="underline decoration-amber-400/40 hover:text-white">answer ↗</a>
        </p>
      )}
      {pr && (
        <div>
          <p className="text-zinc-200">
            <span className="text-zinc-500">Change: </span>
            {pr.title}
          </p>
          {hasDetails && (
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-1 text-zinc-400 hover:text-white">
              {open ? "Hide the details ▴" : `Show the details ▾ (${[pr.summary.length > 0 ? `${pr.summary.length} points` : "", pr.images.length > 0 ? `${pr.images.length} screenshots` : ""].filter(Boolean).join(", ")})`}
            </button>
          )}
          {open && pr.summary.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-zinc-300 sm:text-zinc-400">
              {pr.summary.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          )}
          {open && pr.images.length > 0 && (
            // One swipeable row, phone-height thumbnails; tap opens full size.
            <div className="-mx-3 mt-2 flex snap-x gap-2 overflow-x-auto px-3 pb-1">
              {pr.images.map((u) => (
                <a key={u} href={u} target="_blank" rel="noreferrer" title={/before/i.test(u) ? "Before" : /after/i.test(u) ? "After" : "Open full size"} className="block shrink-0 snap-start overflow-hidden rounded-md border border-edge bg-black/40">
                  {/* eslint-disable-next-line @next/next/no-img-element -- raw.githubusercontent, no next/image config */}
                  <img src={u} alt={/before/i.test(u) ? "Before" : /after/i.test(u) ? "After" : "Screenshot from the run"} loading="lazy" className="h-72 w-auto object-contain sm:h-44" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        {st.state === "pr-ready" && pr && (
          <button type="button" onClick={merge} disabled={merging} className={`${PRIMARY} h-8 px-3 text-xs disabled:opacity-50`}>
            {merging ? "Merging…" : "Merge → goes live"}
          </button>
        )}
        {deploy && <span className={deploy.cls}>{deploy.text}</span>}
        <button type="button" onClick={onReply} title="Reply to this — text or a photo. Then ▶ Run again sends the whole thread to the runner." className="text-zinc-400 hover:text-white">↳ Reply</button>
        {(st.state === "done" || st.state === "pr-ready") && (
          <button type="button" onClick={reload} className="text-zinc-500 hover:text-zinc-300">Refresh</button>
        )}
      </div>
    </div>
  );
}
/**
 * Photos on a note (Chris, 09-09: "for my thoughts, i need a image update
 * option for easy reference"). Phone photos are 4–6 MB; the upload route caps
 * at 4 MB, so shrink to ≤1600px JPEG on the client first (a screenshot or a
 * card photo stays perfectly readable at that size).
 */
const MAX_IMAGES = 6;
async function shrinkImage(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1_500_000) { bitmap.close(); return file; }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.85));
}
async function uploadImage(file: File): Promise<string> {
  const blob = await shrinkImage(file);
  const form = new FormData();
  form.append("file", new File([blob], blob === file ? file.name : "photo.jpg", { type: blob.type || file.type }));
  const res = await fetch(apiPath("/api/admin/board/image"), { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Couldn't upload the photo");
  return data.url as string;
}
function deleteImage(url: string) {
  void fetch(apiPath("/api/admin/board/image"), { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
}

/** Paperclip: picks photos (camera roll on the phone), uploads, hands back the URLs. */
function PhotoButton({ count, onAdd, onError, className = "", compact = false }: { count: number; onAdd: (urls: string[]) => void; onError: (m: string) => void; className?: string; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const full = count >= MAX_IMAGES;
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []).slice(0, MAX_IMAGES - count);
          e.target.value = "";
          if (!files.length) return;
          setBusy(true);
          try {
            onAdd(await Promise.all(files.map(uploadImage)));
          } catch (err) {
            onError(err instanceof Error ? err.message : "Couldn't upload the photo");
          } finally {
            setBusy(false);
          }
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy || full}
        title={full ? `Up to ${MAX_IMAGES} photos per note` : "Attach a photo"}
        aria-label={full ? `Up to ${MAX_IMAGES} photos per note` : "Attach a photo"}
        className={compact ? `flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100 disabled:opacity-25 ${className}` : `rounded px-2 py-1 text-zinc-400 hover:bg-white/5 hover:text-white disabled:opacity-30 ${className}`}
      >
        {busy ? (compact ? "…" : "Uploading…") : compact ? "📎" : "📎 Photo"}
      </button>
    </>
  );
}

/** Thumbnails under a note; tap opens the full image, × removes it (and the blob). */
function Thumbs({ urls, onRemove }: { urls: string[]; onRemove: (url: string) => void }) {
  if (!urls.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {urls.map((u) => (
        <span key={u} className="group/thumb relative">
          <a href={u} target="_blank" rel="noreferrer" title="Open full size" className="block overflow-hidden rounded-md border border-edge bg-black/40">
            {/* eslint-disable-next-line @next/next/no-img-element -- blob host, no next/image config */}
            <img src={u} alt="Attached photo" loading="lazy" className="h-20 w-20 object-cover" />
          </a>
          <button
            type="button"
            onClick={() => onRemove(u)}
            aria-label="Remove photo"
            title="Remove photo"
            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-edge bg-surface-1 text-[11px] text-zinc-300 opacity-70 hover:bg-red-500/30 hover:text-white group-hover/thumb:opacity-100"
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

/** "3m" / "2h" / "1d" since the Run press — Chris, 09-09: "there was no task time indicator". */
function since(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / (60 * 24))}d`;
}

/**
 * The board, live in the admin console (Chris, 09-09: add/delete
 * categories, a category for his own thoughts, clickable checkboxes).
 * Every change edits a local copy and saves the whole board a moment later
 * (PUT /api/admin/board). Tap a checkbox to tick, the text to edit, the
 * owner chip to cycle it, ⋯ for move/delete; each card has an add box.
 */

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const OWNER_CYCLE: BoardOwner[] = ["Chris", "Claude", "both", null];

/**
 * Completed (Chris, 09-09: "once tasks are 100% complete, they move to a
 * complete section … you should be the only one completing these tasks").
 * Mirrors normalizeBoard on the server so a tick, a merged-and-live run, or
 * a reopen shows in the right place before the save round-trips.
 */
const isCompleted = (s: BoardSection) => /^completed$|^done/i.test(s.title.trim());
function sweepCompleted(sections: BoardSection[]): BoardSection[] {
  const now = Date.now();
  const next = sections.map((s) => ({ ...s, items: s.items.slice() }));
  let completed = next.find(isCompleted);
  if (!completed) {
    completed = { id: uid(), title: "Completed", hint: "what got finished, newest first", items: [] };
    next.push(completed);
  }
  const arrivals: BoardItem[] = [];
  for (const s of next) {
    if (s === completed) continue;
    const keep: BoardItem[] = [];
    for (const it of s.items) {
      if (it.done) arrivals.push({ ...it, completedAt: it.completedAt ?? now, from: it.from ?? s.title });
      else keep.push(it);
    }
    s.items = keep;
  }
  const reopened = completed.items.filter((it) => !it.done);
  if (reopened.length) {
    completed.items = completed.items.filter((it) => it.done);
    for (const it of reopened) {
      const home = next.find((s) => s !== completed && s.title === it.from) ?? next.find((s) => s !== completed);
      const { completedAt: _a, from: _b, ...clean } = it;
      void _a; void _b;
      home?.items.push(clean);
    }
  }
  if (arrivals.length) completed.items = [...arrivals.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)), ...completed.items];
  if (next[next.length - 1] !== completed) {
    next.splice(next.indexOf(completed), 1);
    next.push(completed);
  }
  return next;
}

/** A note with replies: the first line is the task, "↳ Chris: …" lines are replies. */
function noteLines(text: string): { head: string; replies: string[] } {
  const [head, ...rest] = text.split(/\r?\n/);
  return { head, replies: rest.filter((l) => l.trim()) };
}

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (same(d, y)) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Chris's thoughts are notes, not tasks. Tapping a note's box opens its
 * options (make it a task somewhere, run it, reply, complete, delete)
 * instead of ticking it straight into Completed (Chris, 09-10: "it should
 * just give options and complete should be an option").
 */
const isNotes = (title: string) => /thought|note/i.test(title);

function tone(title: string): string {
  if (/^now/i.test(title)) return "border-brand-400/40";
  if (/thought|note/i.test(title)) return "border-rose-400/35";
  if (/^chris/i.test(title)) return "border-amber-400/30";
  if (/^claude/i.test(title)) return "border-sky-400/30";
  if (/^done/i.test(title)) return "border-emerald-400/25";
  return "border-edge";
}
function defaultOwner(title: string): BoardOwner {
  if (/thought|note/i.test(title)) return null;
  if (/^chris|launch/i.test(title)) return "Chris";
  if (/^claude|backburner/i.test(title)) return "Claude";
  return "both";
}
function chipClass(o: BoardOwner): string {
  if (o === "Chris") return "bg-amber-400/15 text-amber-300";
  if (o === "Claude") return "bg-sky-400/15 text-sky-300";
  if (o === "both") return "bg-violet-400/15 text-violet-300";
  return "bg-zinc-700/60 text-zinc-400";
}

const INPUT = "rounded-lg border border-edge bg-black/40 px-3 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400 sm:text-sm";
const PRIMARY = "rounded-full bg-brand-500 font-semibold text-white transition hover:bg-brand-400";
const GHOST = "rounded-full border border-edge text-zinc-300 transition hover:bg-white/5";

type Status = "saved" | "saving" | "dirty" | "error";

export default function AdminBoard({ sections: initial, updatedAt: initialStamp = null }: { sections: BoardSection[]; updatedAt?: number | null }) {
  const [sections, setSections] = useState<BoardSection[]>(initial);
  const [status, setStatus] = useState<Status>("saved");
  const [error, setError] = useState<string | null>(null);
  const [newCat, setNewCat] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(sections);
  // The updatedAt this copy came from. Every save sends it; a save built on a
  // stale copy comes back 409 with the live board, which replaces ours.
  const base = useRef<number | null>(initialStamp);

  const save = useCallback(async () => {
    setStatus("saving");
    const sent = latest.current;
    try {
      const res = await fetch(apiPath("/api/admin/board"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: sent, base: base.current }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.sections) {
        if (timer.current) clearTimeout(timer.current);
        latest.current = data.sections;
        setSections(data.sections);
        base.current = typeof data.updatedAt === "number" ? data.updatedAt : null;
        throw new Error(data.error ?? "The tasks changed elsewhere — reloaded it. Redo that last edit.");
      }
      if (!res.ok) throw new Error(data.error ?? "Couldn't save");
      if (typeof data.updatedAt === "number") base.current = data.updatedAt;
      // The server sweeps done items into Completed; take its word for it
      // unless another edit landed meanwhile.
      if (data.sections && latest.current === sent) {
        latest.current = data.sections;
        setSections(data.sections);
      }
      setStatus("saved");
      setError(null);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Couldn't save");
    }
  }, []);

  /** Apply a change, sweep done items into Completed, and schedule a save. */
  const update = useCallback(
    (fn: (prev: BoardSection[]) => BoardSection[]) => {
      setSections((prev) => {
        const next = sweepCompleted(fn(prev));
        latest.current = next;
        return next;
      });
      setStatus("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), 700);
    },
    [save],
  );
  // Leaving the page inside the debounce window must not lose the edit:
  // flush the pending save on unmount.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        void save();
      }
    },
    [save],
  );

  const [tab, setTab] = useState<"live" | "completed">("live");
  const completedSection = sections.find(isCompleted);
  const completedCount = completedSection?.items.length ?? 0;
  const live = sections.filter((s) => !isCompleted(s));
  const [view, setViewState] = useState<"cards" | "list">("cards");
  useEffect(() => {
    // Read after mount on purpose: the server can't see localStorage and a
    // lazy initializer would mismatch the SSR markup.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem("cardflip.boardView") === "list") setViewState("list");
    } catch {
      /* private mode */
    }
  }, []);
  const setView = (v: "cards" | "list") => {
    setViewState(v);
    try {
      localStorage.setItem("cardflip.boardView", v);
    } catch {
      /* ignore */
    }
  };

  const [reload, setReload] = useState(false);
  const [runs, setRuns] = useState<Record<number, RunStatus>>({});
  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch(apiPath("/api/admin/board/runs"), { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.runs) {
        const runs = data.runs as Record<number, RunStatus>;
        setRuns(runs);
        // A run that is merged AND live is 100% done — it completes itself
        // (Chris, 09-09: "you should be the only one completing these tasks").
        const finished = new Set(Object.entries(runs).filter(([, r]) => r.state === "done" && r.deploy === "ready").map(([n]) => Number(n)));
        if (finished.size) {
          update((prev) =>
            prev.map((sec) => ({
              ...sec,
              items: sec.items.map((i) => {
                const n = /^▶ RUNNING #(\d+)/.exec(i.text)?.[1];
                return n && !i.done && finished.has(Number(n)) ? { ...i, done: true } : i;
              }),
            })),
          );
        }
      }
    } catch {
      /* the chips fall back to Running */
    }
  }, [update]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRuns();
  }, [loadRuns]);
  // Live chips (Chris, 09-09: "I keep having to refresh the page"). While a
  // run is still moving — working, PR open, merged but not yet deployed —
  // re-read every 20s; otherwise every 2 minutes; and always when the tab
  // comes back into view. ~4 GitHub calls per read, well inside the token's
  // hourly budget for one open board.
  const moving = Object.values(runs).some(
    (r) => r.state === "running" || r.state === "pr-ready" || (r.state === "done" && r.deploy !== "ready" && r.deploy !== "failed"),
  );
  useEffect(() => {
    const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
    const tick = () => { if (visible()) void loadRuns(); };
    const id = setInterval(tick, moving ? 20_000 : 120_000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [moving, loadRuns]);
  // Coming back to the tab: if the live board moved on (Claude, another
  // tab) and nothing is unsaved here, take the live copy quietly.
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== "visible" || timer.current || status === "saving" || status === "dirty") return;
      try {
        const res = await fetch(apiPath("/api/admin/board"), { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.sections && typeof data.updatedAt === "number" && data.updatedAt !== base.current) {
          latest.current = data.sections;
          base.current = data.updatedAt;
          setSections(data.sections);
        }
      } catch {
        /* next focus */
      }
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [status]);
  const run = useCallback(async (id: string) => {
    if (timer.current) clearTimeout(timer.current);
    setStatus("saving");
    try {
      const res = await fetch(apiPath("/api/admin/board/run"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't start the task");
      latest.current = data.sections;
      if (typeof data.updatedAt === "number") base.current = data.updatedAt;
      setSections(data.sections);
      setStatus("saved");
      setError(null);
      void loadRuns();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Couldn't start the task");
    }
  }, [loadRuns]);

  const reseed = useCallback(async () => {
    setReload(false);
    if (timer.current) clearTimeout(timer.current);
    setStatus("saving");
    try {
      const res = await fetch(apiPath("/api/admin/board"), { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't reload");
      latest.current = data.sections;
      base.current = typeof data.updatedAt === "number" ? data.updatedAt : null;
      setSections(data.sections);
      setStatus("saved");
      setError(null);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Couldn't reload");
    }
  }, []);

  const patchSection = (id: string, fn: (s: BoardSection) => BoardSection) => update((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));
  const patchItem = (sid: string, iid: string, fn: (i: BoardItem) => BoardItem) =>
    patchSection(sid, (s) => ({ ...s, items: s.items.map((i) => (i.id === iid ? fn(i) : i)) }));
  const removeItem = (sid: string, iid: string) => patchSection(sid, (s) => ({ ...s, items: s.items.filter((i) => i.id !== iid) }));
  const addItem = (sid: string, text: string, owner: BoardOwner, images: string[] = []) =>
    patchSection(sid, (s) => ({ ...s, items: [...s.items, { id: uid(), done: false, owner, text, ...(images.length ? { images } : {}) }] }));
  const setImages = (sid: string, iid: string, images: string[]) =>
    patchItem(sid, iid, (i) => {
      const { images: _drop, ...rest } = i;
      void _drop;
      return images.length ? { ...rest, images } : rest;
    });
  const reorderItem = (sid: string, iid: string, dir: -1 | 1) =>
    patchSection(sid, (s) => {
      const i = s.items.findIndex((it) => it.id === iid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.items.length) return s;
      const items = s.items.slice();
      [items[i], items[j]] = [items[j], items[i]];
      return { ...s, items };
    });
  const moveItem = (from: string, iid: string, to: string) =>
    update((prev) => {
      const item = prev.find((s) => s.id === from)?.items.find((i) => i.id === iid);
      if (!item || from === to) return prev;
      return prev.map((s) =>
        s.id === from ? { ...s, items: s.items.filter((i) => i.id !== iid) } : s.id === to ? { ...s, items: [...s.items, item] } : s,
      );
    });
  const moveSection = (id: string, dir: -1 | 1) =>
    update((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const removeSection = (id: string) => update((prev) => prev.filter((s) => s.id !== id));
  const addSection = (title: string, hint: string) => {
    update((prev) => [...prev, { id: uid(), title, hint: hint || null, items: [] }]);
    setNewCat(false);
  };

  return (
    <RunsContext.Provider value={{ runs, reload: () => void loadRuns() }}>
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">Tap a box to tick it, the text to edit, ⋯ to move or delete. In your thoughts the box opens the options instead. Saves itself. Pick the owner when you add a task; after that Claude re-tags it as it moves.</p>
        <div className="flex items-center gap-3 text-xs">
          <p className={status === "error" ? "text-red-300" : status === "saved" ? "text-emerald-300/80" : "text-zinc-500"} aria-live="polite">
            {status === "saved" ? "Saved" : status === "saving" ? "Saving…" : status === "dirty" ? "Unsaved" : error}
            {status === "error" && (
              <button onClick={() => void save()} className="ml-2 underline">Retry</button>
            )}
          </p>
          {reload ? (
            <span className="flex items-center gap-1 text-zinc-400">
              Replaces everything here with docs/BOARD.md (your Chris&apos;s thoughts stay).
              <button onClick={() => void reseed()} className="rounded bg-red-500/20 px-2 py-1 text-red-200">Reload</button>
              <button onClick={() => setReload(false)} className="rounded px-2 py-1 hover:bg-white/5">Keep mine</button>
            </span>
          ) : (
            <button onClick={() => setReload(true)} className="text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline" title="Claude updated the file in the repo? Pull it in.">
              Reload from file
            </button>
          )}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <div role="tablist" aria-label="Live or completed" className="flex rounded-full border border-brand-400/40 bg-surface-1 p-0.5">
          {(["live", "completed"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1 font-medium transition ${tab === t ? "bg-brand-500/30 text-white" : "text-zinc-400 hover:text-white"}`}
            >
              {t === "live" ? "Live" : `Completed${completedCount ? ` · ${completedCount}` : ""}`}
            </button>
          ))}
        </div>
        {tab === "live" && (
          <div role="tablist" aria-label="Tasks view" className="flex rounded-full border border-edge bg-surface-1 p-0.5">
            {(["cards", "list"] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`rounded-full px-3 py-1 transition ${view === v ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"}`}
              >
                {v === "cards" ? "Cards" : "List"}
              </button>
            ))}
          </div>
        )}
        {tab === "live" && view === "list" && <span className="text-zinc-500">Every open task, ranked by Claude&apos;s priority — Now first, then launch gates, your list, Claude&apos;s queue, prove-on-prod, technical, future, backburner, thoughts.</span>}
        {tab === "completed" && <span className="text-zinc-500">Finished work, newest first. Claude moves tasks here; a merged run lands here on its own once it is live. Un-tick to reopen.</span>}
      </div>
      {tab === "completed" ? (
        <CompletedView
          section={completedSection}
          all={sections}
          onToggle={(iid) => completedSection && patchItem(completedSection.id, iid, (i) => ({ ...i, done: !i.done }))}
          onRemove={(iid) => completedSection && removeItem(completedSection.id, iid)}
          onError={setError}
        />
      ) : view === "list" ? (
        <ol className="rounded-2xl border border-edge bg-surface-1 p-3">
          {rankedItems(live).map(({ item, section, rank }) => (
            <li key={item.id} className="flex items-start gap-2 border-b border-white/5 py-1 last:border-0">
              <span className="w-7 shrink-0 pt-1 text-right text-[11px] tabular-nums text-zinc-600">{rank}</span>
              <span className={`mt-1 shrink-0 rounded px-1.5 py-px text-[10px] font-medium ${catChip(section.title)}`} title={section.hint ?? undefined}>{section.title}</span>
              <ul className="min-w-0 flex-1">
                <ItemRow
                  item={item}
                  items={section.items}
                  all={live}
                  sectionId={section.id}
                  note={isNotes(section.title)}
                  onToggle={() => patchItem(section.id, item.id, (i) => ({ ...i, done: !i.done }))}
                  onText={(t) => (t.trim() ? patchItem(section.id, item.id, (i) => ({ ...i, text: t.trim() })) : removeItem(section.id, item.id))}
                  onRemove={() => removeItem(section.id, item.id)}
                  onImages={(imgs) => setImages(section.id, item.id, imgs)}
                  onError={setError}
                  onRun={() => void run(item.id)}
                  onMove={(to) => moveItem(section.id, item.id, to)}
                  onReorder={(dir) => reorderItem(section.id, item.id, dir)}
                />
              </ul>
            </li>
          ))}
          {rankedItems(live).length === 0 && <li className="py-4 text-center text-xs text-zinc-500">Nothing open.</li>}
        </ol>
      ) : (
      <div className="grid gap-4 md:grid-cols-2">
        {live.map((s, idx) => (
          <SectionCard
            key={s.id}
            section={s}
            all={live}
            first={idx === 0}
            last={idx === live.length - 1}
            onRename={(title, hint) => patchSection(s.id, (x) => ({ ...x, title, hint }))}
            onMove={(dir) => moveSection(s.id, dir)}
            onDelete={() => removeSection(s.id)}
            onToggle={(iid) => patchItem(s.id, iid, (i) => ({ ...i, done: !i.done }))}
            onText={(iid, text) => (text.trim() ? patchItem(s.id, iid, (i) => ({ ...i, text: text.trim() })) : removeItem(s.id, iid))}
            onRemoveItem={(iid) => removeItem(s.id, iid)}
            onImages={(iid, imgs) => setImages(s.id, iid, imgs)}
            onError={setError}
            onRunItem={(iid) => void run(iid)}
            onMoveItem={(iid, to) => moveItem(s.id, iid, to)}
            onReorderItem={(iid, dir) => reorderItem(s.id, iid, dir)}
            onAdd={(text, owner, images) => addItem(s.id, text, owner, images)}
          />
        ))}
        {newCat ? (
          <NewSection onCreate={addSection} onCancel={() => setNewCat(false)} />
        ) : (
          <button
            onClick={() => setNewCat(true)}
            className="flex min-h-[88px] items-center justify-center rounded-2xl border border-dashed border-zinc-700 text-sm text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
          >
            + New category
          </button>
        )}
      </div>
      )}
    </div>
    </RunsContext.Provider>
  );
}

/**
 * Claude's priority order for the flat list: the category decides the
 * band (Now beats everything; Chris's thoughts are notes, so last), and
 * the order inside a card — which Claude keeps meaningful — breaks ties.
 */
function categoryRank(title: string): number {
  if (/^now/i.test(title)) return 0;
  if (/launch/i.test(title)) return 1;
  if (/^chris\b(?!.*(thought|note))/i.test(title)) return 2;
  if (/^claude/i.test(title)) return 3;
  if (/prove/i.test(title)) return 4;
  if (/technical/i.test(title)) return 5;
  if (/future/i.test(title)) return 6;
  if (/backburner/i.test(title)) return 7;
  if (/thought|note/i.test(title)) return 8;
  if (/^done/i.test(title)) return 9;
  return 5.5;
}
function rankedItems(sections: BoardSection[]): { item: BoardItem; section: BoardSection; rank: number }[] {
  const rows = sections.flatMap((section, si) =>
    section.items.filter((i) => !i.done).map((item, ii) => ({ item, section, key: [categoryRank(section.title), si, ii] })),
  );
  rows.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2]);
  return rows.map((r, i) => ({ item: r.item, section: r.section, rank: i + 1 }));
}
function catChip(title: string): string {
  if (/^now/i.test(title)) return "bg-brand-500/15 text-brand-300";
  if (/thought|note/i.test(title)) return "bg-rose-400/15 text-rose-300";
  if (/^chris/i.test(title)) return "bg-amber-400/15 text-amber-300";
  if (/^claude/i.test(title)) return "bg-sky-400/15 text-sky-300";
  if (/launch/i.test(title)) return "bg-emerald-400/15 text-emerald-300";
  return "bg-white/5 text-zinc-400";
}

function SectionCard(props: {
  section: BoardSection;
  all: BoardSection[];
  first: boolean;
  last: boolean;
  onRename: (title: string, hint: string | null) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  onToggle: (iid: string) => void;
  onText: (iid: string, text: string) => void;
  onRemoveItem: (iid: string) => void;
  onImages: (iid: string, images: string[]) => void;
  onError: (message: string) => void;
  onRunItem: (iid: string) => void;
  onMoveItem: (iid: string, to: string) => void;
  onReorderItem: (iid: string, dir: -1 | 1) => void;
  onAdd: (text: string, owner: BoardOwner, images: string[]) => void;
}) {
  const { section: s } = props;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(s.title);
  const [hint, setHint] = useState(s.hint ?? "");
  const [confirm, setConfirm] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftOwner, setDraftOwner] = useState<BoardOwner>(defaultOwner(s.title));
  const [draftImages, setDraftImages] = useState<string[]>([]);
  const [hideDone, setHideDone] = useState(false);
  const open = s.items.filter((i) => !i.done).length;
  const done = s.items.length - open;

  function commitRename() {
    setEditing(false);
    const t = title.trim();
    if (!t) { setTitle(s.title); return; }
    props.onRename(t, hint.trim() || null);
  }
  function submitDraft() {
    const t = draft.trim();
    if (!t) return;
    props.onAdd(t, draftOwner, draftImages);
    setDraft("");
    setDraftImages([]);
  }

  return (
    <section className={`flex flex-col rounded-2xl border bg-surface-1 p-4 ${tone(s.title)}`}>
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <form
            className="flex min-w-0 flex-1 flex-col gap-1.5"
            onSubmit={(e) => { e.preventDefault(); commitRename(); }}
          >
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} aria-label="Category name" className={`${INPUT} h-9 text-sm`} />
            <input value={hint} onChange={(e) => setHint(e.target.value)} maxLength={120} placeholder="Short hint (optional)" aria-label="Category hint" className={`${INPUT} h-9 text-xs`} />
            <div className="flex gap-2">
              <button type="submit" className={`${PRIMARY} h-8 px-3 text-xs`}>Save</button>
              <button type="button" onClick={() => { setEditing(false); setTitle(s.title); setHint(s.hint ?? ""); }} className={`${GHOST} h-8 px-3 text-xs`}>Cancel</button>
            </div>
          </form>
        ) : (
          <button onClick={() => setEditing(true)} className="min-w-0 text-left" title="Rename this category">
            <h3 className="text-sm font-semibold text-white">
              {s.title}
              {s.hint && <span className="ml-2 text-xs font-normal text-zinc-500">{s.hint}</span>}
            </h3>
          </button>
        )}
        {!editing && (
          <div className="flex shrink-0 items-center gap-1 text-xs text-zinc-500">
            <span className="mr-1">{open} open</span>
            <IconBtn label="Move up" onClick={() => props.onMove(-1)} disabled={props.first}>↑</IconBtn>
            <IconBtn label="Move down" onClick={() => props.onMove(1)} disabled={props.last}>↓</IconBtn>
            {confirm ? (
              <span className="flex items-center gap-1">
                <button onClick={props.onDelete} className="rounded bg-red-500/20 px-2 py-1 text-red-200">Delete {s.items.length ? `(${s.items.length})` : ""}</button>
                <button onClick={() => setConfirm(false)} className="rounded px-2 py-1 hover:bg-white/5">Keep</button>
              </span>
            ) : (
              <IconBtn label="Delete category" onClick={() => setConfirm(true)}>×</IconBtn>
            )}
          </div>
        )}
      </div>

      <ul className="mt-3 space-y-1.5">
        {s.items.filter((i) => !(hideDone && i.done)).map((it) => (
          <ItemRow
            key={it.id}
            item={it}
            items={s.items}
            all={props.all}
            sectionId={s.id}
            note={isNotes(s.title)}
            onToggle={() => props.onToggle(it.id)}
            onText={(t) => props.onText(it.id, t)}
            onRemove={() => props.onRemoveItem(it.id)}
            onImages={(imgs) => props.onImages(it.id, imgs)}
            onError={props.onError}
            onRun={() => props.onRunItem(it.id)}
            onReorder={(dir) => props.onReorderItem(it.id, dir)}
            onMove={(to) => props.onMoveItem(it.id, to)}
          />
        ))}
        {s.items.length === 0 && <li className="text-xs text-zinc-600">Nothing here yet.</li>}
      </ul>
      {done > 0 && (
        <button onClick={() => setHideDone((v) => !v)} className="mt-2 self-start text-[11px] text-zinc-500 hover:text-zinc-300">
          {hideDone ? `Show ${done} done` : `Hide ${done} done`}
        </button>
      )}

      <form
        className="mt-3 flex items-center gap-1.5 border-t border-edge pt-3"
        onSubmit={(e) => { e.preventDefault(); submitDraft(); }}
      >
        <button
          type="button"
          onClick={() => setDraftOwner(OWNER_CYCLE[(OWNER_CYCLE.indexOf(draftOwner) + 1) % OWNER_CYCLE.length])}
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${chipClass(draftOwner)}`}
          title="Who the new task is for — tap to change"
          aria-label={`New task owner: ${draftOwner ? ownerLabel(draftOwner) : "nobody"}. Tap to change`}
        >
          {ownerLabel(draftOwner)}
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={/thought|note/i.test(s.title) ? "Jot a thought…" : "Add a task…"}
          aria-label={`Add to ${s.title}`}
          maxLength={1000}
          className={`${INPUT} h-9 min-w-0 flex-1 text-[13px]`}
        />
        <PhotoButton count={draftImages.length} onAdd={(urls) => setDraftImages((v) => [...v, ...urls].slice(0, MAX_IMAGES))} onError={props.onError} className="h-9 shrink-0 text-xs" />
        <button type="submit" disabled={!draft.trim()} className={`${PRIMARY} h-9 shrink-0 px-3 text-xs disabled:opacity-40`}>Add</button>
      </form>
      <Thumbs urls={draftImages} onRemove={(u) => { deleteImage(u); setDraftImages((v) => v.filter((x) => x !== u)); }} />
    </section>
  );
}

function ItemRow(props: {
  item: BoardItem;
  items: BoardItem[];
  all: BoardSection[];
  sectionId: string;
  /** A note in Chris's thoughts: the box opens the options, Complete is one of them. */
  note?: boolean;
  onToggle: () => void;
  onText: (t: string) => void;
  onRemove: () => void;
  onImages: (images: string[]) => void;
  onError: (message: string) => void;
  onRun: () => void;
  onMove: (to: string) => void;
  onReorder: (dir: -1 | 1) => void;
}) {
  const { item: it, note } = props;
  const { runs } = useContext(RunsContext);
  const runNo = /^▶ RUNNING #(\d+)/.exec(it.text)?.[1];
  const runStatus = runNo ? runs[Number(runNo)] : undefined;
  const idx = props.items.findIndex((i) => i.id === it.id);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(it.text);
  const [more, setMore] = useState(false);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [replyImages, setReplyImages] = useState<string[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const { head, replies } = noteLines(it.text);
  // Run again once the runner has stopped (question, closed, PR open, merged):
  // the route closes the old issue and the new one carries the whole thread,
  // so Chris can reply to any output and send it back (Chris, 09-09).
  const canRun = !it.done && (!runNo || (runStatus != null && runStatus.state !== "running"));

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.style.height = "0px";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [editing, text]);

  function commit() {
    setEditing(false);
    if (text.trim() !== it.text) props.onText(text);
  }

  return (
    <li className={`group -mx-1 rounded-lg px-1 py-0.5 ${more ? "bg-white/[0.03]" : ""}`}>
      <div className="flex items-start gap-2 text-[13px] leading-snug">
        {note && !it.done ? (
          <button
            aria-expanded={more}
            aria-label={more ? "Close options" : "Options"}
            title="What to do with this thought"
            onClick={() => setMore((v) => !v)}
            className={`mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${more ? "border-rose-300/70 bg-rose-400/15" : "border-zinc-500 hover:border-zinc-300"}`}
          >
            {more && <span className="h-1.5 w-1.5 rounded-sm bg-rose-300" />}
          </button>
        ) : (
          <button
            role="checkbox"
            aria-checked={it.done}
            aria-label={it.done ? "Mark not done" : "Mark done"}
            onClick={props.onToggle}
            className={`mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${it.done ? "border-emerald-400/50 bg-emerald-400/25 text-emerald-200" : "border-zinc-500 hover:border-zinc-300"}`}
          >
            {it.done && <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6l3 3 5-6" /></svg>}
          </button>
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <textarea
              ref={ref}
              autoFocus
              value={text}
              rows={1}
              maxLength={1000}
              onChange={(e) => setText(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
                if (e.key === "Escape") { setText(it.text); setEditing(false); }
              }}
              aria-label="Edit item"
              className={`${INPUT} w-full resize-none py-1 text-[13px] leading-snug`}
            />
          ) : (
            <span className={it.done ? "text-zinc-500 line-through decoration-zinc-700" : "text-zinc-200"}>
              {it.owner && (
                <span title="Owner — set by Claude from the task status" className={`mr-1.5 inline-block rounded px-1.5 py-px align-[1px] text-[10px] font-semibold ${chipClass(it.owner)}`}>
                  {ownerLabel(it.owner)}
                </span>
              )}
              {(() => {
                const m = /^▶ RUNNING #(\d+) — ([\s\S]*)$/.exec(it.text);
                if (!m) return <button onClick={() => { setText(it.text); setEditing(true); }} className="text-left hover:text-white">{head}</button>;
                const st = runs[Number(m[1])];
                const chip = RUN_CHIP[st?.state ?? "running"];
                const href = st?.url ?? `https://github.com/truefreemoney-rgb/cardflip/issues/${m[1]}`;
                return (
                  <>
                    <a href={href} target="_blank" rel="noreferrer" title={chip.hint} className={`mr-1 rounded px-1.5 py-px text-[11px] font-semibold ${chip.cls}`}>{chip.label} #{m[1]}{st ? ` · ${since(st.startedAt)}` : ""} ↗</a>
                    <button onClick={() => { setText(it.text); setEditing(true); }} className="text-left hover:text-white">{noteLines(m[2]).head}</button>
                  </>
                );
              })()}
            </span>
          )}
          {!editing && replies.length > 0 && (
            <ul className="mt-1 space-y-0.5 border-l border-white/10 pl-2 text-[12px] text-zinc-400">
              {replies.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
          <Thumbs urls={it.images ?? []} onRemove={(u) => { deleteImage(u); props.onImages((it.images ?? []).filter((x) => x !== u)); }} />
          {runStatus && !editing && <RunPanel st={runStatus} onError={props.onError} onReply={() => setReplying(true)} />}
          {replying && (
            <form
              className="mt-1.5 flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const t = reply.trim();
                if (!t && replyImages.length === 0) return;
                // A photo-only reply still leaves a line so the thread reads in order.
                props.onText(`${it.text}\n↳ Chris: ${t || "(photo)"}${replyImages.length && t ? ` (+${replyImages.length} photo${replyImages.length === 1 ? "" : "s"})` : ""}`);
                if (replyImages.length) props.onImages([...(it.images ?? []), ...replyImages].slice(0, MAX_IMAGES));
                setReply("");
                setReplyImages([]);
                setReplying(false);
              }}
            >
              <input autoFocus value={reply} onChange={(e) => setReply(e.target.value)} maxLength={400} placeholder="Your reply…" aria-label="Reply" className={`${INPUT} h-8 min-w-0 flex-1 text-[13px]`} onKeyDown={(e) => { if (e.key === "Escape") { setReplying(false); setReplyImages([]); } }} />
              <PhotoButton count={(it.images?.length ?? 0) + replyImages.length} onAdd={(urls) => setReplyImages((v) => [...v, ...urls])} onError={props.onError} className="h-8 text-xs" />
              <button type="submit" disabled={!reply.trim() && replyImages.length === 0} className={`${PRIMARY} h-8 px-3 text-xs disabled:opacity-40`}>Reply</button>
              {replyImages.length > 0 && <Thumbs urls={replyImages} onRemove={(u) => { deleteImage(u); setReplyImages((v) => v.filter((x) => x !== u)); }} />}
            </form>
          )}
        </div>
        <PhotoButton compact count={it.images?.length ?? 0} onAdd={(urls) => props.onImages([...(it.images ?? []), ...urls].slice(0, MAX_IMAGES))} onError={props.onError} className="opacity-40 group-hover:opacity-100 focus:opacity-100" />
        <IconBtn label="More" onClick={() => setMore((v) => !v)} className="opacity-40 group-hover:opacity-100 focus:opacity-100">⋯</IconBtn>
      </div>
      {more && (
        <div className="ml-6 mt-1 flex flex-wrap items-center gap-2 text-xs">
          {note && !it.done && (
            <button onClick={() => { props.onToggle(); setMore(false); }} title="Done with this thought — it moves to Completed" className="rounded border border-emerald-400/40 px-2 py-1 text-emerald-200 hover:bg-emerald-500/15">✓ Complete</button>
          )}
          <label className="flex items-center gap-1 text-zinc-500">
            Move to
            <select
              value={props.sectionId}
              onChange={(e) => { props.onMove(e.target.value); setMore(false); }}
              className={`${INPUT} h-8 py-0 text-xs`}
              aria-label="Move to category"
            >
              {props.all.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
          <button onClick={() => { props.onReorder(-1); setMore(false); }} disabled={idx <= 0} className="rounded px-2 py-1 text-zinc-400 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent">Move up</button>
          <button onClick={() => { props.onReorder(1); setMore(false); }} disabled={idx < 0 || idx >= props.items.length - 1} className="rounded px-2 py-1 text-zinc-400 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent">Move down</button>
          <PhotoButton count={it.images?.length ?? 0} onAdd={(urls) => { props.onImages([...(it.images ?? []), ...urls].slice(0, MAX_IMAGES)); setMore(false); }} onError={props.onError} />
          <button onClick={() => { setReplying(true); setMore(false); }} title="Add a reply under this note — for Claude, or for the runner before you press Run again" className="rounded px-2 py-1 text-zinc-400 hover:bg-white/5">↳ Reply</button>
          <button onClick={() => { props.onRun(); setMore(false); }} disabled={!canRun} title={runNo && canRun ? "Runs again with the whole thread (your replies + photos); the old issue is closed" : "Opens a GitHub issue; the cloud board runner does the task and opens a PR"} className="rounded bg-emerald-500/15 px-2 py-1 text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-30">{runNo && canRun ? "▶ Run again" : "▶ Run"}</button>
          <button onClick={props.onRemove} className="rounded px-2 py-1 text-red-300 hover:bg-red-500/10">Delete</button>
        </div>
      )}
    </li>
  );
}

/** The Completed tab: finished work grouped by day, newest first; un-tick to reopen, ⋯ to delete. */
function CompletedView(props: {
  section: BoardSection | undefined;
  all: BoardSection[];
  onToggle: (iid: string) => void;
  onRemove: (iid: string) => void;
  onError: (m: string) => void;
}) {
  const { runs } = useContext(RunsContext);
  const items = props.section?.items ?? [];
  if (!items.length) return <div className="rounded-2xl border border-edge bg-surface-1 p-6 text-center text-xs text-zinc-500">Nothing completed yet.</div>;
  const groups: { day: string; items: BoardItem[] }[] = [];
  for (const it of items) {
    const day = it.completedAt ? dayLabel(it.completedAt) : "Earlier";
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(it);
    else groups.push({ day, items: [it] });
  }
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.day} className="rounded-2xl border border-emerald-400/20 bg-surface-1 p-4">
          <h3 className="text-sm font-semibold text-white">{g.day}</h3>
          <ul className="mt-2 space-y-1.5">
            {g.items.map((it) => {
              const m = /^▶ RUNNING #(\d+) — ([\s\S]*)$/.exec(it.text);
              const st = m ? runs[Number(m[1])] : undefined;
              const { head, replies } = noteLines(m ? m[2] : it.text);
              return (
                <li key={it.id} className="group -mx-1 rounded-lg px-1 py-0.5">
                  <div className="flex items-start gap-2 text-[13px] leading-snug">
                    <button
                      role="checkbox"
                      aria-checked
                      aria-label="Reopen"
                      title="Un-tick to reopen it where it came from"
                      onClick={() => props.onToggle(it.id)}
                      className="mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center rounded border border-emerald-400/50 bg-emerald-400/25 text-emerald-200"
                    >
                      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6l3 3 5-6" /></svg>
                    </button>
                    <div className="min-w-0 flex-1">
                      <span className="text-zinc-300">
                        {it.from && <span className={`mr-1.5 inline-block rounded px-1.5 py-px align-[1px] text-[10px] font-medium ${catChip(it.from)}`}>{it.from}</span>}
                        {it.owner && <span className={`mr-1.5 inline-block rounded px-1.5 py-px align-[1px] text-[10px] font-semibold ${chipClass(it.owner)}`}>{ownerLabel(it.owner)}</span>}
                        {m && st && <a href={st.url} target="_blank" rel="noreferrer" className="mr-1 rounded bg-emerald-400/20 px-1.5 py-px text-[11px] font-semibold text-emerald-100">✓ #{m[1]} ↗</a>}
                        {head}
                      </span>
                      {replies.length > 0 && (
                        <ul className="mt-1 space-y-0.5 border-l border-white/10 pl-2 text-[12px] text-zinc-500">
                          {replies.map((r, i) => <li key={i}>{r}</li>)}
                        </ul>
                      )}
                      <Thumbs urls={it.images ?? []} onRemove={() => undefined} />
                      {st?.pr && (
                        <p className="mt-1 text-[12px] text-zinc-500">
                          <span className="text-zinc-600">Change: </span>
                          {st.pr.title}
                        </p>
                      )}
                    </div>
                    <IconBtn label="Delete" onClick={() => props.onRemove(it.id)} className="opacity-40 hover:text-red-300 group-hover:opacity-100 focus:opacity-100">×</IconBtn>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function NewSection({ onCreate, onCancel }: { onCreate: (title: string, hint: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [hint, setHint] = useState("");
  return (
    <form
      className="flex flex-col gap-2 rounded-2xl border border-dashed border-zinc-600 bg-surface-1 p-4"
      onSubmit={(e) => { e.preventDefault(); if (title.trim()) onCreate(title.trim(), hint.trim()); }}
    >
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Category name" aria-label="New category name" className={`${INPUT} h-9 text-sm`} />
      <input value={hint} onChange={(e) => setHint(e.target.value)} maxLength={120} placeholder="Short hint (optional)" aria-label="New category hint" className={`${INPUT} h-9 text-xs`} />
      <div className="flex gap-2">
        <button type="submit" disabled={!title.trim()} className={`${PRIMARY} h-8 px-3 text-xs disabled:opacity-40`}>Create</button>
        <button type="button" onClick={onCancel} className={`${GHOST} h-8 px-3 text-xs`}>Cancel</button>
      </div>
    </form>
  );
}

function IconBtn({ label, onClick, disabled, className = "", children }: { label: string; onClick: () => void; disabled?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100 disabled:opacity-25 disabled:hover:bg-transparent ${className}`}
    >
      {children}
    </button>
  );
}
