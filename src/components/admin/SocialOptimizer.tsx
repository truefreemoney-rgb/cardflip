"use client";

import { useState } from "react";

/**
 * The daily optimization loop's switch on /admin/social (Chris 10-02; 10-03
 * the rotation): on, the 8am job draws tomorrow's 7am and 7pm post kinds (and
 * each angle's game) by score; off, it scores and reports and the schedule
 * stays as it is. Under the switch: tomorrow's picks and each kind's score
 * (1.0 = an average post on its site; "–" = too few posts yet).
 */
export interface OptimizerPick {
  kind: string;
  game: string | null;
  /** "picture" when the slot posts its picture instead of the video (phase 5); anything else is the video. */
  format?: string;
}
export interface OptimizerScore {
  kind: string;
  posts: number;
  days: number;
  score: number | null;
}
export default function SocialOptimizer({
  on: initial,
  day,
  why,
  forDay,
  picks,
  scores,
  names,
  games,
}: {
  on: boolean;
  day: string | null;
  why: string | null;
  forDay: string | null;
  picks: { morning: OptimizerPick; evening: OptimizerPick } | null;
  scores: OptimizerScore[];
  /** Kind → label, game → label (lib/socialOptimize.ts KIND_NAME / GAME_NAME, passed in so this stays a client component). */
  names: Record<string, string>;
  games: Record<string, string>;
}) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function flip() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/social/posts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "optimizer", on: !on }) });
      const j = (await res.json()) as { optimizer?: boolean; error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setOn(j.optimizer === true);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const pick = (p: OptimizerPick) => `${names[p.kind] ?? p.kind}${p.game ? ` · ${games[p.game] ?? p.game}` : ""}${p.format === "picture" ? " · picture" : ""}`;
  return (
    <div className="mb-3 rounded-xl border border-edge px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={flip}
          disabled={busy}
          role="switch"
          aria-checked={on}
          title={on ? "The 8am job draws tomorrow's 7am and 7pm posts by score. Press to freeze the schedule." : "The schedule is frozen. Press to let the 8am job draw tomorrow's posts."}
          className={`rounded-full border px-3 py-1 ${on ? "border-emerald-400/50 text-emerald-300" : "border-edge text-zinc-400"} disabled:opacity-40`}
        >
          Optimizer {on ? "On" : "Off"}
        </button>
        {picks && forDay ? (
          <span className="text-zinc-200">
            {forDay}: <span className="text-white">7am {pick(picks.morning)}</span> · <span className="text-white">7pm {pick(picks.evening)}</span>
          </span>
        ) : null}
        <span className="min-w-0 flex-1 text-zinc-400">{note ?? (why ? `${day}: ${why}` : "First run is at 8am ET.")}</span>
      </div>
      {scores.length ? (
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-400">
          {scores.map((s) => (
            <li key={s.kind} title={`${s.posts} posts over ${s.days} days`}>
              {names[s.kind] ?? s.kind} <span className={s.score != null ? "text-zinc-200" : ""}>{s.score != null ? s.score.toFixed(2) : `– (${s.posts})`}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
