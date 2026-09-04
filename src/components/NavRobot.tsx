"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import RobotBuddy, { type RobotPose } from "@/components/RobotBuddy";
import Spinner from "@/components/Spinner";
import Link from "next/link";
import { apiPath } from "@/lib/client/basePath";
import { requestTourReplay } from "@/lib/client/tour";
import { HELP_LINKS, TAG_RE, guideById } from "@/lib/helpGuides";
import { startGuide } from "@/components/TourOverlay";

/**
 * The robot's home: a Help button in the app header (Chris, 09-04: "your AI
 * companion, lives in the nav, changes posture and attitude"). He shifts
 * pose every 20–40 s from a shortlist of moods; a tap opens the help chat —
 * one rolling conversation per account, answered by /api/help/chat, so it
 * carries across pages and sessions. Header lives in the app layout, so
 * this state survives navigation too.
 */

const MOODS: RobotPose[] = ["idle", "idle", "think", "shrug", "wave", "sleep", "idle", "celebrate"];

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: { type: "guide" | "link"; value: string }[];
}

const OPENER = "Ask me anything about CardFlip. Scans, prices, eBay, billing. I read the manual so you don't have to.";

/** Empty-chat starters (Chris, 09-04: solve 99% the easiest way — nobody should have to type). */
const STARTERS = [
  "How do I connect eBay?",
  "Why can't I publish yet?",
  "How do I change a listed price?",
  "Where do the prices come from?",
  "How do I get emailed when a card dips?",
  "What does my plan include?",
];

/** Split a reply into its text and the actions the robot tagged. */
function parseReply(content: string): { text: string; guide: string | null; link: string | null } {
  let guide: string | null = null;
  let link: string | null = null;
  const text = content
    .replace(TAG_RE, (_, kind: string, value: string) => {
      const v = value.trim();
      if (kind === "guide" && guideById(v)) guide = v;
      if (kind === "link" && v in HELP_LINKS) link = v;
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, guide, link };
}

export default function NavRobot() {
  const router = useRouter();
  const [pose, setPose] = useState<RobotPose>("idle");
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Wander through moods. Never the same one twice in a row.
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      setPose((prev) => {
        let next = prev;
        while (next === prev) next = MOODS[Math.floor(Math.random() * MOODS.length)];
        return next;
      });
      timer = window.setTimeout(tick, 20000 + Math.random() * 20000);
    };
    timer = window.setTimeout(tick, 8000 + Math.random() * 8000);
    return () => window.clearTimeout(timer);
  }, []);

  // History loads on first open; afterwards the panel keeps what it has.
  useEffect(() => {
    if (!open || messages !== null) return;
    let cancelled = false;
    fetch(apiPath("/api/help/chat"))
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((data) => {
        if (!cancelled) setMessages(data.messages ?? []);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, messages]);

  // Newest message in view; focus the box when the panel opens.
  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    if (!busy) inputRef.current?.focus();
  }, [open, messages, busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const send = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const text = draft.trim();
      if (!text || busy) return;
      setDraft("");
      setError(null);
      setBusy(true);
      const mine: Msg = { id: `local-${Date.now()}`, role: "user", content: text };
      setMessages((m) => [...(m ?? []), mine]);
      try {
        const res = await fetch(apiPath("/api/help/chat"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "The robot didn't answer. Try again.");
          return;
        }
        setMessages((m) => [...(m ?? []), data.reply as Msg]);
      } catch {
        setError("No connection. Try again in a moment.");
      } finally {
        setBusy(false);
      }
    },
    [draft, busy],
  );

  const clear = useCallback(async () => {
    setMessages([]);
    setError(null);
    await fetch(apiPath("/api/help/chat"), { method: "DELETE" }).catch(() => undefined);
  }, []);

  const headerPose: RobotPose = open ? (busy ? "think" : "wave") : pose;

  function ask(text: string) {
    setDraft(text);
    // Submit on the next tick so the draft is in state.
    window.setTimeout(() => formRef.current?.requestSubmit(), 0);
  }
  function runGuide(id: string) {
    const g = guideById(id);
    if (!g) return;
    setOpen(false);
    startGuide(g.steps);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Help"
        data-tour="help"
        aria-expanded={open}
        title="Help"
        className="flex h-9 items-center gap-1 rounded-full py-1 pl-1 pr-3 text-xs font-medium text-zinc-400 transition hover:bg-surface-2 hover:text-zinc-200"
      >
        <RobotBuddy pose={headerPose} size={30} float={false} />
        Help
      </button>

      {open && (
        <>
          {/* Phones: dim the page behind the sheet; a tap outside closes. */}
          <button
            className="fixed inset-0 z-40 cursor-default bg-black/50 sm:hidden"
            aria-label="Close help"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Help"
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col rounded-t-2xl border border-edge bg-surface-1 shadow-2xl shadow-black/60 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-11 sm:h-[520px] sm:max-h-[70vh] sm:w-[360px] sm:rounded-2xl"
          >
            <div className="flex items-center gap-2 border-b border-edge px-4 py-2.5">
              <RobotBuddy pose={busy ? "think" : "idle"} size={28} float={false} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">The robot</p>
                <p className="truncate text-[11px] text-zinc-500">Help, tours, moral support</p>
              </div>
              {messages && messages.length > 0 && (
                <button onClick={clear} className="text-[11px] text-zinc-500 transition hover:text-zinc-300">
                  Clear
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                aria-label="Close help"
                className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 transition hover:bg-surface-2 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
              <Bubble role="assistant">{OPENER}</Bubble>
              {messages === null && (
                <p className="text-center text-[11px] text-zinc-600">
                  <Spinner className="mr-1 inline h-3 w-3" /> remembering…
                </p>
              )}
              {messages && messages.length === 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {STARTERS.map((q) => (
                    <button
                      key={q}
                      onClick={() => ask(q)}
                      className="rounded-full border border-edge bg-surface-2/60 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-edge-strong hover:text-white"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {messages?.map((m) => {
                if (m.role === "user") {
                  return (
                    <Bubble key={m.id} role="user">
                      {m.content}
                    </Bubble>
                  );
                }
                // Server sends clean text + actions; the parse is a fallback for
                // a reply that still carries raw tags (older server, same client).
                const parsed = parseReply(m.content);
                const text = parsed.text;
                const guideId = m.actions?.find((a) => a.type === "guide")?.value ?? parsed.guide;
                const link = m.actions?.find((a) => a.type === "link")?.value ?? parsed.link;
                const g = guideId ? guideById(guideId) : null;
                return (
                  <div key={m.id} className="flex flex-col items-start gap-1.5">
                    <Bubble role="assistant">{text}</Bubble>
                    {(g || link) && (
                      <div className="flex flex-wrap gap-1.5 pl-1">
                        {g && (
                          <button
                            onClick={() => runGuide(g.id)}
                            className="rounded-full bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-400"
                          >
                            Walk me through it
                          </button>
                        )}
                        {link && (
                          <Link
                            href={link}
                            onClick={() => setOpen(false)}
                            className="rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-edge-strong hover:text-white"
                          >
                            Open {HELP_LINKS[link]}
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {busy && (
                <Bubble role="assistant">
                  <span className="inline-flex items-center gap-1.5 text-zinc-400">
                    <Spinner className="h-3 w-3" /> thinking
                  </span>
                </Bubble>
              )}
              {error && <p className="text-xs text-amber-300">{error}</p>}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-1 text-[11px] text-zinc-500">
              <button
                onClick={() => {
                  setOpen(false);
                  requestTourReplay();
                  router.push("/app");
                }}
                className="transition hover:text-zinc-300"
              >
                Replay the tour
              </button>
              <a href="mailto:support@cardflip.io" className="transition hover:text-zinc-300">
                Email a human
              </a>
            </div>

            <form
              ref={formRef}
              onSubmit={send}
              className="flex items-center gap-2 border-t border-edge px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
            >
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={600}
                placeholder="Ask the robot"
                aria-label="Your question"
                className="min-w-0 flex-1 rounded-full border border-edge bg-black/40 px-3.5 py-2 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400 sm:text-sm"
              />
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                className="rounded-full bg-brand-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

function Bubble({ role, children }: { role: "user" | "assistant"; children: React.ReactNode }) {
  const mine = role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <p
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
          mine ? "rounded-br-md bg-brand-500 text-white" : "rounded-bl-md bg-surface-2 text-zinc-200"
        }`}
      >
        {children}
      </p>
    </div>
  );
}
