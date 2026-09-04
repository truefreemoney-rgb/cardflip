"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { useFocusTrap } from "@/lib/client/useFocusTrap";
import { markTourSeen, takeTourReplay } from "@/lib/client/tour";
import RobotBuddy, { type RobotPose } from "@/components/RobotBuddy";
import type { GuideStep } from "@/lib/helpGuides";

/** The help robot asks for a walkthrough: window event with the steps. */
export const GUIDE_EVENT = "cardflip:guide";
export function startGuide(steps: GuideStep[]): void {
  window.dispatchEvent(new CustomEvent(GUIDE_EVENT, { detail: { steps } }));
}

/**
 * First-login tutorial: coach marks over the real app, page by page. Each
 * page has a few steps; the last step on a page hands off to the next page
 * (Chris, 09-04: "one page leads to another"). A spotlight (box-shadow
 * cut-out, so the element underneath stays live and un-blurred) sits on
 * the anchor; the robot (RobotBuddy) sits on the card's corner and points
 * at the target — he IS the pointer (Chris, 09-04: the arrows and rings
 * read as robotic; the robot doesn't, oddly). Steps
 * whose anchor isn't on the page (the editor only exists after a scan; the
 * Inventory toolbar only with cards) run as a centred card.
 *
 * Voice (Chris, 09-04): the guide is a slightly self-aware robot that
 * knows it lives in an overlay — the one place the dry-voice rule bends,
 * to loosen a new seller up. Keep it deadpan; no exclamation marks.
 *
 * Progress lives in sessionStorage so a navigation or reload mid-tour
 * resumes where it was. Shown once per account (users.tour_seen_at,
 * stamped on Done / Skip / ✕ / Esc / click-away); the account page's Replay
 * and `/app?tour=1` re-run it.
 */

interface Step {
  /** Page the step lives on; Next on a page boundary navigates there. */
  path: string;
  /** CSS selector of the element to spotlight; none = centred card. */
  sel?: string;
  round?: boolean;
  title: string;
  body: string;
}

const CARD_INPUT = 'input[placeholder^="Name or number"]';

const TOUR: Step[] = [
  {
    path: "/app",
    sel: '[data-tour="help"]',
    round: true,
    title: "That's me",
    body: "I live up here. Tap me for help, tours, moral support.",
  },
  {
    path: "/app",
    sel: '[data-tour="capture"]',
    round: true,
    title: "Scan a card",
    body: "Point, tap Capture. I name it and price it. You get the credit.",
  },
  {
    path: "/app",
    title: "Check, then sell",
    body: "Tap Verify if I got it right, then Publish. I always get it right.",
  },
  {
    path: "/app/collection",
    sel: '[aria-label="Card game"]',
    round: true,
    title: "Inventory",
    body: "Every card you scan, kept tidy. It's most of my personality.",
  },
  {
    path: "/app/collection",
    sel: '[aria-label="Switch view"]',
    round: true,
    title: "Image or Text",
    body: "Art or list. Tap a price to change it, even live. I won't tell eBay.",
  },
  {
    path: "/app/collection",
    sel: '[aria-label="Sort cards"]',
    round: true,
    title: "Sort and filter",
    body: "Sort and filter. You'll need it. Binders always get big.",
  },
  {
    path: "/app/price-check",
    sel: CARD_INPUT,
    title: "Search cards",
    body: "Price any card, no scan. For cards you can't hold. I relate.",
  },
  {
    path: "/app/wishlist",
    sel: CARD_INPUT,
    title: "Watchlist",
    body: "Watch a card, I email you when it dips. I'm up anyway.",
  },
  {
    path: "/app/wishlist",
    title: "That's the tour",
    body: "I'm in the header if you need me. Now go scan something.",
  },
];

const PAD = 6;
const PROGRESS_KEY = "cardflip.tourStep";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

type Side = "top" | "bottom" | "left" | "right";

function readProgress(): number | null {
  try {
    const raw = sessionStorage.getItem(PROGRESS_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n < TOUR.length ? n : null;
  } catch {
    return null;
  }
}

function writeProgress(step: number | null): void {
  try {
    if (step == null) sessionStorage.removeItem(PROGRESS_KEY);
    else sessionStorage.setItem(PROGRESS_KEY, String(step));
  } catch {
    // Storage blocked — the tour just won't survive a reload.
  }
}

function urlAsksForTour(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("tour") === "1";
}

export default function TourOverlay() {
  const { user, status, setUser } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [step, setStepState] = useState<number | null>(null);
  // Guides (09-04): the help robot's walkthroughs run on this engine with
  // their own steps; they never stamp tour_seen_at or touch the progress key.
  const [steps, setSteps] = useState<Step[]>(TOUR);
  const guide = steps !== TOUR;
  // Captured during the first render: the scanner page wipes its query
  // string in a mount effect, which runs before this one.
  const [urlStart] = useState(urlAsksForTour);
  const [rect, setRect] = useState<Rect | null>(null);
  /** Pointer tail on the card: which edge faces the target, and where along it (px). */
  const [tail, setTail] = useState<{ side: Side; at: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const open = step !== null;

  const setStep = useCallback(
    (next: number | null) => {
      if (!guide) writeProgress(next);
      setStepState(next);
    },
    [guide],
  );

  // A guide request from the chat: swap in its steps, start at the first,
  // navigate if it lives on another page.
  useEffect(() => {
    const onGuide = (e: Event) => {
      const detail = (e as CustomEvent<{ steps: GuideStep[] }>).detail;
      if (!detail?.steps?.length) return;
      setSteps(detail.steps);
      setStepState(0);
      if (detail.steps[0].path !== window.location.pathname) router.push(detail.steps[0].path);
    };
    window.addEventListener(GUIDE_EVENT, onGuide);
    return () => window.removeEventListener(GUIDE_EVENT, onGuide);
  }, [router]);

  const ready = status === "ready" && !!user && user.appAccess !== false;

  // Start: owed by the account (on the scanner), a replay requested from the
  // account page or ?tour=1, or progress left over from a navigation/reload.
  useEffect(() => {
    if (!ready || open) return;
    const here = TOUR.findIndex((s) => s.path === pathname);
    const resume = readProgress();
    let start: number | null = null;
    if (takeTourReplay() || urlStart) {
      start = here >= 0 ? here : 0;
    } else if (resume != null) {
      // Same page: pick up where it was. Another tour page: the seller
      // navigated on their own — restart from that page. Elsewhere: wait.
      start = TOUR[resume].path === pathname ? resume : here >= 0 ? here : null;
    } else if (pathname === "/app" && user?.tourSeenAt == null) {
      start = 0;
    }
    if (start == null) return;
    // Let the page paint its anchors first.
    const t = window.setTimeout(() => setStep(start), 400);
    return () => window.clearTimeout(t);
  }, [ready, open, pathname, user?.tourSeenAt, urlStart, setStep]);

  // Between pages (Next just navigated) the card hides until the new page is up.
  const current = open && steps[step] && pathname === steps[step].path ? steps[step] : null;

  // One measurement pass for the spotlight AND the card's tail, so they
  // never disagree. State only changes when the rounded numbers change
  // (09-04: a per-scroll re-render made the old arrow chase a sliding card).
  useLayoutEffect(() => {
    if (!current) return;
    const el = current.sel ? document.querySelector<HTMLElement>(current.sel) : null;
    if (!el) {
      const t = window.setTimeout(() => {
        setRect(null);
        setTail(null);
      }, 0);
      return () => window.clearTimeout(t);
    }
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" as ScrollBehavior });

    const measure = () => {
      const r = el.getBoundingClientRect();
      const next: Rect = {
        top: Math.round(r.top - PAD),
        left: Math.round(r.left - PAD),
        width: Math.round(r.width + PAD * 2),
        height: Math.round(r.height + PAD * 2),
      };
      setRect((prev) =>
        prev && prev.top === next.top && prev.left === next.left && prev.width === next.width && prev.height === next.height
          ? prev
          : next,
      );
      const card = panelRef.current?.getBoundingClientRect();
      if (!card) return;
      const cx = next.left + next.width / 2;
      const cy = next.top + next.height / 2;
      const clampX = Math.round(Math.min(Math.max(cx - card.left, 24), card.width - 24));
      const clampY = Math.round(Math.min(Math.max(cy - card.top, 24), card.height - 24));
      const t: { side: Side; at: number } =
        next.top + next.height <= card.top
          ? { side: "top", at: clampX }
          : next.top >= card.bottom
            ? { side: "bottom", at: clampX }
            : next.left + next.width <= card.left
              ? { side: "left", at: clampY }
              : { side: "right", at: clampY };
      setTail((prev) => (prev && prev.side === t.side && prev.at === t.at ? prev : t));
    };

    // Off the effect body (react-hooks rule) and as timeouts, not rAF —
    // frames pause in background tabs. The second pass catches the card
    // after it has taken its position from the first; the third catches
    // pages whose data lands after first paint.
    const timers = [0, 40, 400].map((ms) => window.setTimeout(measure, ms));
    let pending: number | null = null;
    const throttled = () => {
      if (pending != null) return;
      pending = window.setTimeout(() => {
        pending = null;
        measure();
      }, 60);
    };
    window.addEventListener("resize", throttled);
    window.addEventListener("scroll", throttled, true);
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      if (pending != null) window.clearTimeout(pending);
      window.removeEventListener("resize", throttled);
      window.removeEventListener("scroll", throttled, true);
    };
  }, [current]);

  const finish = useCallback(async () => {
    setStep(null);
    if (guide) {
      setSteps(TOUR);
      return;
    }
    if (user && user.tourSeenAt == null) {
      setUser({ ...user, tourSeenAt: Date.now() });
      await markTourSeen();
    }
  }, [guide, user, setUser, setStep]);

  const go = useCallback(
    (next: number) => {
      setStep(next);
      if (steps[next].path !== pathname) router.push(steps[next].path);
    },
    [steps, pathname, router, setStep],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void finish();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, finish]);

  useFocusTrap(panelRef, !!current);

  if (!current || step === null) return null;

  const last = step === steps.length - 1;
  const nextLeavesPage = !last && steps[step + 1].path !== current.path;
  const nextLabel = last ? (guide ? "Got it" : "Bye, robot") : nextLeavesPage ? `On to ${steps[step + 1].title}` : "Next";
  const radius = current.round ? 9999 : 14;
  const box = rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height, borderRadius: radius } : undefined;

  // Card placement (sm and up): under the anchor if there's room, else above.
  // Below sm the card is a bottom sheet regardless.
  let panelStyle: React.CSSProperties | undefined;
  if (rect && typeof window !== "undefined" && window.innerWidth >= 640) {
    // 56px gap: room for the robot on the card's corner between the two.
    const below = rect.top + rect.height + 56;
    const roomBelow = window.innerHeight - below > 220;
    const left = Math.min(Math.max(rect.left, 16), window.innerWidth - 16 - 360);
    panelStyle = roomBelow ? { top: below, left } : { bottom: window.innerHeight - rect.top + 56, left };
  }

  // The robot points where the target is; with nothing to point at he
  // waves in, thinks, or celebrates the end.
  const pose: RobotPose =
    rect && tail
      ? ((tail.side === "top" ? "point-up" : tail.side === "bottom" ? "point-down" : `point-${tail.side}`) as RobotPose)
      : last
        ? "celebrate"
        : "think";

  return (
    <div className="tour-in fixed inset-0 z-[60]">
      {box ? (
        <>
          <div className="tour-spot pointer-events-none absolute" style={box} />
        </>
      ) : (
        <div className="absolute inset-0 bg-[#05060c]/75" />
      )}
      {/* Click-away ends the tour, same as Skip. */}
      <button className="absolute inset-0 cursor-default" aria-label="Skip the tutorial" onClick={() => void finish()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${guide ? "Guide" : "Tutorial"}, step ${step + 1} of ${steps.length}: ${current.title}`}
        tabIndex={-1}
        className={`tour-card absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] rounded-2xl border border-edge bg-surface-1 p-4 shadow-2xl shadow-black/60 outline-none sm:inset-x-auto sm:bottom-auto sm:w-[360px] sm:p-5 ${
          panelStyle ? "" : "sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2"
        }`}
        style={panelStyle}
      >
        <div className="pointer-events-none absolute -top-12 left-2">
          <RobotBuddy pose={pose} size={60} />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5" aria-hidden>
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? "w-4 bg-brand-400" : i < step ? "w-1.5 bg-brand-400/50" : "w-1.5 bg-zinc-700"
                }`}
              />
            ))}
          </div>
          <button
            onClick={() => void finish()}
            aria-label="Close the tutorial"
            className="-mr-1.5 -mt-1.5 flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 transition hover:bg-surface-2 hover:text-white"
          >
            ✕
          </button>
        </div>
        <h2 className="font-display mt-2 text-lg font-semibold text-white">{current.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-zinc-300">{current.body}</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          {last ? (
            <span />
          ) : (
            <button onClick={() => void finish()} className="text-xs font-medium text-zinc-500 transition hover:text-zinc-200">
              Skip
            </button>
          )}
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={() => go(step - 1)}
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-surface-2 hover:text-white"
              >
                Back
              </button>
            )}
            <button
              autoFocus
              onClick={() => (last ? void finish() : go(step + 1))}
              className="whitespace-nowrap rounded-full bg-brand-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-400"
            >
              {nextLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
