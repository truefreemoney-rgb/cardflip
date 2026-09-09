"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardItem, BoardOwner, BoardSection } from "@/lib/server/board";
import { apiPath } from "@/lib/client/basePath";
import { ownerLabel } from "@/components/admin/format";

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

export default function AdminBoard({ sections: initial }: { sections: BoardSection[] }) {
  const [sections, setSections] = useState<BoardSection[]>(initial);
  const [status, setStatus] = useState<Status>("saved");
  const [error, setError] = useState<string | null>(null);
  const [newCat, setNewCat] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(sections);

  const save = useCallback(async () => {
    setStatus("saving");
    try {
      const res = await fetch(apiPath("/api/admin/board"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: latest.current }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't save");
      setStatus("saved");
      setError(null);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Couldn't save");
    }
  }, []);

  /** Apply a change and schedule a save. */
  const update = useCallback(
    (fn: (prev: BoardSection[]) => BoardSection[]) => {
      setSections((prev) => {
        const next = fn(prev);
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
  const run = useCallback(async (id: string) => {
    if (timer.current) clearTimeout(timer.current);
    setStatus("saving");
    try {
      const res = await fetch(apiPath("/api/admin/board/run"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't start the task");
      latest.current = data.sections;
      setSections(data.sections);
      setStatus("saved");
      setError(null);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Couldn't start the task");
    }
  }, []);

  const reseed = useCallback(async () => {
    setReload(false);
    if (timer.current) clearTimeout(timer.current);
    setStatus("saving");
    try {
      const res = await fetch(apiPath("/api/admin/board"), { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't reload");
      latest.current = data.sections;
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
  const addItem = (sid: string, text: string, owner: BoardOwner) =>
    patchSection(sid, (s) => ({ ...s, items: [...s.items, { id: uid(), done: false, owner, text }] }));
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
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">Tap a box to tick it, the text to edit, ⋯ to move or delete. Saves itself. Pick the owner when you add a task; after that Claude re-tags it as it moves.</p>
        <div className="flex items-center gap-3 text-xs">
          <p className={status === "error" ? "text-red-300" : status === "saved" ? "text-emerald-300/80" : "text-zinc-500"} aria-live="polite">
            {status === "saved" ? "Saved" : status === "saving" ? "Saving…" : status === "dirty" ? "Unsaved" : error}
            {status === "error" && (
              <button onClick={() => void save()} className="ml-2 underline">Retry</button>
            )}
          </p>
          {reload ? (
            <span className="flex items-center gap-1 text-zinc-400">
              Replaces everything here with docs/BOARD.md (your Chris's thoughts stay).
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
      <div className="mb-3 flex items-center gap-2 text-xs">
        <div role="tablist" aria-label="Board view" className="flex rounded-full border border-edge bg-surface-1 p-0.5">
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
        {view === "list" && <span className="text-zinc-500">Every open task, ranked by Claude&apos;s priority — Now first, then launch gates, your list, Claude&apos;s queue, prove-on-prod, technical, future, backburner, thoughts.</span>}
      </div>
      {view === "list" ? (
        <ol className="rounded-2xl border border-edge bg-surface-1 p-3">
          {rankedItems(sections).map(({ item, section, rank }) => (
            <li key={item.id} className="flex items-start gap-2 border-b border-white/5 py-1 last:border-0">
              <span className="w-7 shrink-0 pt-1 text-right text-[11px] tabular-nums text-zinc-600">{rank}</span>
              <span className={`mt-1 shrink-0 rounded px-1.5 py-px text-[10px] font-medium ${catChip(section.title)}`} title={section.hint ?? undefined}>{section.title}</span>
              <ul className="min-w-0 flex-1">
                <ItemRow
                  item={item}
                  items={section.items}
                  all={sections}
                  sectionId={section.id}
                  onToggle={() => patchItem(section.id, item.id, (i) => ({ ...i, done: !i.done }))}
                  onText={(t) => (t.trim() ? patchItem(section.id, item.id, (i) => ({ ...i, text: t.trim() })) : removeItem(section.id, item.id))}
                  onRemove={() => removeItem(section.id, item.id)}
                  onRun={() => void run(item.id)}
                  onMove={(to) => moveItem(section.id, item.id, to)}
                  onReorder={(dir) => reorderItem(section.id, item.id, dir)}
                />
              </ul>
            </li>
          ))}
          {rankedItems(sections).length === 0 && <li className="py-4 text-center text-xs text-zinc-500">Nothing open.</li>}
        </ol>
      ) : (
      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((s, idx) => (
          <SectionCard
            key={s.id}
            section={s}
            all={sections}
            first={idx === 0}
            last={idx === sections.length - 1}
            onRename={(title, hint) => patchSection(s.id, (x) => ({ ...x, title, hint }))}
            onMove={(dir) => moveSection(s.id, dir)}
            onDelete={() => removeSection(s.id)}
            onToggle={(iid) => patchItem(s.id, iid, (i) => ({ ...i, done: !i.done }))}
            onText={(iid, text) => (text.trim() ? patchItem(s.id, iid, (i) => ({ ...i, text: text.trim() })) : removeItem(s.id, iid))}
            onRemoveItem={(iid) => removeItem(s.id, iid)}
            onRunItem={(iid) => void run(iid)}
            onMoveItem={(iid, to) => moveItem(s.id, iid, to)}
            onReorderItem={(iid, dir) => reorderItem(s.id, iid, dir)}
            onAdd={(text, owner) => addItem(s.id, text, owner)}
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
  onRunItem: (iid: string) => void;
  onMoveItem: (iid: string, to: string) => void;
  onReorderItem: (iid: string, dir: -1 | 1) => void;
  onAdd: (text: string, owner: BoardOwner) => void;
}) {
  const { section: s } = props;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(s.title);
  const [hint, setHint] = useState(s.hint ?? "");
  const [confirm, setConfirm] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftOwner, setDraftOwner] = useState<BoardOwner>(defaultOwner(s.title));
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
    props.onAdd(t, draftOwner);
    setDraft("");
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
            onToggle={() => props.onToggle(it.id)}
            onText={(t) => props.onText(it.id, t)}
            onRemove={() => props.onRemoveItem(it.id)}
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
        <button type="submit" disabled={!draft.trim()} className={`${PRIMARY} h-9 shrink-0 px-3 text-xs disabled:opacity-40`}>Add</button>
      </form>
    </section>
  );
}

function ItemRow(props: {
  item: BoardItem;
  items: BoardItem[];
  all: BoardSection[];
  sectionId: string;
  onToggle: () => void;
  onText: (t: string) => void;
  onRemove: () => void;
  onRun: () => void;
  onMove: (to: string) => void;
  onReorder: (dir: -1 | 1) => void;
}) {
  const { item: it } = props;
  const idx = props.items.findIndex((i) => i.id === it.id);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(it.text);
  const [more, setMore] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

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
        <button
          role="checkbox"
          aria-checked={it.done}
          aria-label={it.done ? "Mark not done" : "Mark done"}
          onClick={props.onToggle}
          className={`mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${it.done ? "border-emerald-400/50 bg-emerald-400/25 text-emerald-200" : "border-zinc-500 hover:border-zinc-300"}`}
        >
          {it.done && <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6l3 3 5-6" /></svg>}
        </button>
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
              <button onClick={() => { setText(it.text); setEditing(true); }} className="text-left hover:text-white">{it.text}</button>
            </span>
          )}
        </div>
        <IconBtn label="More" onClick={() => setMore((v) => !v)} className="opacity-40 group-hover:opacity-100 focus:opacity-100">⋯</IconBtn>
      </div>
      {more && (
        <div className="ml-6 mt-1 flex flex-wrap items-center gap-2 text-xs">
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
          <button onClick={() => { props.onRun(); setMore(false); }} disabled={it.done || /^▶ RUNNING #d+/.test(it.text)} title="Opens a GitHub issue; the cloud board runner does the task and opens a PR" className="rounded bg-emerald-500/15 px-2 py-1 text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-30">▶ Run</button>
          <button onClick={props.onRemove} className="rounded px-2 py-1 text-red-300 hover:bg-red-500/10">Delete</button>
        </div>
      )}
    </li>
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
