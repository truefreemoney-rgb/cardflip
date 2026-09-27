"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import RobotBuddy, { type RobotPose } from "@/components/RobotBuddy";
import HelpPanel from "@/components/HelpPanel";

/**
 * The robot's home: a Help button in the app header (Chris, 09-04: "your AI
 * companion, lives in the nav, changes posture and attitude"). He shifts
 * pose every 20–40 s from a shortlist of moods. A tap on desktop opens the
 * help popover under the button; on phones it goes to /app/help, a real page
 * (Chris 09-26: the bottom sheet fought the keyboard, ate drafts on a stray
 * tap and ignored Back). The panel body is HelpPanel in both cases.
 */

const MOODS: RobotPose[] = ["idle", "idle", "think", "shrug", "wave", "sleep", "idle", "celebrate"];

/** Tailwind sm: below this the popover is a page instead. */
const DESKTOP = "(min-width: 640px)";

export default function NavRobot() {
  const router = useRouter();
  const pathname = usePathname();
  const [pose, setPose] = useState<RobotPose>("idle");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  // The popover is portalled to <body>: the header's backdrop-blur makes it
  // a containing block for position:fixed (Chris, 09-04). It anchors under
  // the button by measuring it.
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      if (!window.matchMedia(DESKTOP).matches) {
        setOpen(false);
        return;
      }
      const r = btnRef.current?.getBoundingClientRect();
      setAnchor(r ? { left: r.left, top: r.bottom + 6 } : null);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const close = useCallback(() => setOpen(false), []);
  const onHelp = useCallback(() => {
    if (window.matchMedia(DESKTOP).matches) setOpen((o) => !o);
    else router.push("/app/help");
  }, [router]);

  const onPage = pathname === "/app/help";
  const headerPose: RobotPose = open || onPage ? (busy ? "think" : "wave") : pose;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={onHelp}
        aria-label="Help"
        data-tour="help"
        aria-expanded={open || onPage}
        title="Help"
        className={`flex h-9 flex-col items-center justify-center rounded-full px-1 py-0.5 text-xs font-medium transition hover:bg-surface-2 hover:text-white sm:flex-row sm:gap-1 sm:py-1 sm:pr-2.5 ${
          onPage ? "text-white" : "text-zinc-300"
        }`}
      >
        <RobotBuddy pose={headerPose} size={26} float={false} />
        {/* The word is always on (Chris 09-26: on phones "the reason for it
            is kind of unknown to the user"). On phones it sits UNDER the
            robot as a caption: beside him it made the strip wrap under the
            logo on an owner's phone (Help · 100/100 · eBay, 09-26 evening).
            From sm it rides beside him as before. */}
        <span className="text-[9px] leading-none sm:text-xs sm:leading-normal">Help</span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-label="Help"
          style={anchor ?? undefined}
          className="panel-solid fixed z-50 flex h-[520px] max-h-[70vh] w-[360px] flex-col rounded-2xl border shadow-2xl shadow-black/70"
        >
          <HelpPanel mode="sheet" active={open} onClose={close} onBusy={setBusy} />
        </div>,
        document.body,
      )}
    </div>
  );
}
