"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import RobotBuddy, { type RobotPose } from "@/components/RobotBuddy";
import { requestTourReplay } from "@/lib/client/tour";

/**
 * The robot's home: a small button in the app header (Chris, 09-04: "your
 * AI companion, lives in the nav, changes posture and attitude"). He shifts
 * pose every 20–40 s from a shortlist of idle moods, and a tap opens a
 * speech bubble. Until the chat exists the bubble offers the tour replay
 * and says so, in his voice.
 */

const MOODS: RobotPose[] = ["idle", "idle", "think", "shrug", "wave", "sleep", "idle", "celebrate"];

export default function NavRobot() {
  const router = useRouter();
  const [pose, setPose] = useState<RobotPose>("idle");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

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

  // Click-away / Esc close the bubble.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="The robot"
        aria-expanded={open}
        title="The robot"
        className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-surface-2"
      >
        <RobotBuddy pose={open ? "wave" : pose} size={30} float={false} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="The robot"
          className="absolute left-0 top-11 z-50 w-64 rounded-2xl border border-edge bg-surface-1 p-4 shadow-2xl shadow-black/60"
        >
          <p className="text-sm text-zinc-200">Chat&apos;s coming. Until then I do tours.</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => {
                setOpen(false);
                requestTourReplay();
                router.push("/app");
              }}
              className="rounded-full bg-brand-500 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-400"
            >
              Replay the tour
            </button>
            <button onClick={() => setOpen(false)} className="px-2 text-xs text-zinc-500 transition hover:text-zinc-200">
              Later
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
