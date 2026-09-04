"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { useFocusTrap } from "@/lib/client/useFocusTrap";
import { markTourSeen, takeTourReplay } from "@/lib/client/tour";

/**
 * First-login tutorial: coach marks over the real app, page by page. Each
 * page has a few steps; the last step on a page hands off to the next page
 * (Chris, 09-04: "one page leads to another"). A spotlight (box-shadow
 * cut-out, so the element underneath stays live and un-blurred) sits on
 * the anchor, the card sits beside it — or at the bottom of a phone screen.
 * Steps whose anchor isn't on the page (the editor only exists after a
 * scan; the Inventory toolbar only with cards) run as a centred card.
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

const STEPS: Step[] = [
  {
    path: "/app",
    sel: '[data-tour="capture"]',
    round: true,
    title: "Scan a card",
    body: "Point the camera at a card and tap Capture. CardFlip names it, finds the printing and prices it from live sales.",
  },
  {
    path: "/app",
    title: "Check, then sell",
    body: "Every scan opens an editor. Confirm it's the card in your hand with Verify match, then Publish on eBay — photo, title and price included.",
  },
  {
    path: "/app/collection",
    sel: '[aria-label="Card game"]',
    round: true,
    title: "Inventory",
    body: "Everything you've scanned lives here, Pokémon and Magic kept apart. In play, listed, ended and sold each have their own count.",
  },
  {
    path: "/app/collection",
    sel: '[aria-label="Switch view"]',
    round: true,
    title: "Image or Text",
    body: "Binder view shows the art; Text view is a tight list. Tap a tile to open the card, tap a price to change it — even on a live listing.",
  },
  {
    path: "/app/collection",
    sel: '[aria-label="Sort cards"]',
    round: true,
    title: "Sort and filter",
    body: "Sort by value, rarity or date, and filter by name or set when the binder gets big.",
  },
  {
    path: "/app/price-check",
    sel: CARD_INPUT,
    title: "Search cards",
    body: "Look up any card without scanning it — name or number. Same live pricing, every printing.",
  },
  {
    path: "/app/wishlist",
    sel: CARD_INPUT,
    title: "Watchlist",
    body: "Cards you don't own yet. Watch them and CardFlip emails you when the price dips.",
  },
  {
    path: "/app/wishlist",
    title: "That's the tour",
    body: "Replay it any time from Account → Tutorial. Now go scan something.",
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

function readProgress(): number | null {
  try {
    const raw = sessionStorage.getItem(PROGRESS_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n < STEPS.length ? n : null;
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
  // Captured during the first render: the scanner page wipes its query
  // string in a mount effect, which runs before this one.
  const [urlStart] = useState(urlAsksForTour);
  const [rect, setRect] = useState<Rect | null>(null);
  /** Arrow from the card to the spotlight, viewport coordinates. */
  const [arrow, setArrow] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const open = step !== null;

  const setStep = useCallback((next: number | null) => {
    writeProgress(next);
    setStepState(next);
  }, []);

  const ready = status === "ready" && !!user && user.appAccess !== false;

  // Start: owed by the account (on the scanner), a replay requested from the
  // account page or ?tour=1, or progress left over from a navigation/reload.
  useEffect(() => {
    if (!ready || open) return;
    const here = STEPS.findIndex((s) => s.path === pathname);
    const resume = readProgress();
    let start: number | null = null;
    if (takeTourReplay() || urlStart) {
      start = here >= 0 ? here : 0;
    } else if (resume != null) {
      // Same page: pick up where it was. Another tour page: the seller
      // navigated on their own — restart from that page. Elsewhere: wait.
      start = STEPS[resume].path === pathname ? resume : here >= 0 ? here : null;
    } else if (pathname === "/app" && user?.tourSeenAt == null) {
      start = 0;
    }
    if (start == null) return;
    // Let the page paint its anchors first.
    const t = window.setTimeout(() => setStep(start), 400);
    return () => window.clearTimeout(t);
  }, [ready, open, pathname, user?.tourSeenAt, urlStart, setStep]);

  // Between pages (Next just navigated) the card hides until the new page is up.
  const current = open && pathname === STEPS[step].path ? STEPS[step] : null;

  // Measure the anchor on every step, and follow it through resizes/scrolls.
  useLayoutEffect(() => {
    if (!current) return;
    const el = current.sel ? document.querySelector<HTMLElement>(current.sel) : null;
    if (!el) {
      const t = window.setTimeout(() => setRect(null), 0);
      return () => window.clearTimeout(t);
    }
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
    };
    // A timeout, not rAF: frames pause in background tabs. Re-measured a
    // beat later too, for pages whose data lands after first paint.
    const t = window.setTimeout(measure, 0);
    const t2 = window.setTimeout(measure, 350);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(t2);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [current]);

  // The arrow needs both boxes laid out: the spotlight (state) and the card
  // (its own DOM box, which depends on the spotlight through panelStyle).
  useLayoutEffect(() => {
    if (!rect || !current) {
      const t = window.setTimeout(() => setArrow(null), 0);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => {
      const card = panelRef.current?.getBoundingClientRect();
      if (!card) return;
      const targetCx = rect.left + rect.width / 2;
      const cardCx = card.left + card.width / 2;
      const spotAbove = rect.top + rect.height <= card.top;
      const spotBelow = rect.top >= card.bottom;
      let x1: number, y1: number, x2: number, y2: number;
      if (spotAbove) {
        x1 = cardCx; y1 = card.top - 2; x2 = targetCx; y2 = rect.top + rect.height + 4;
      } else if (spotBelow) {
        x1 = cardCx; y1 = card.bottom + 2; x2 = targetCx; y2 = rect.top - 4;
      } else {
        // Side by side (wide screens): leave from the nearer card edge.
        const targetCy = rect.top + rect.height / 2;
        const leftOf = rect.left + rect.width <= card.left;
        x1 = leftOf ? card.left - 2 : card.right + 2;
        y1 = Math.min(Math.max(targetCy, card.top + 16), card.bottom - 16);
        x2 = leftOf ? rect.left + rect.width + 4 : rect.left - 4;
        y2 = targetCy;
      }
      setArrow(Math.hypot(x2 - x1, y2 - y1) < 28 ? null : { x1, y1, x2, y2 });
    }, 0);
    return () => window.clearTimeout(t);
  }, [rect, current]);

  const finish = useCallback(async () => {
    setStep(null);
    if (user && user.tourSeenAt == null) {
      setUser({ ...user, tourSeenAt: Date.now() });
      await markTourSeen();
    }
  }, [user, setUser, setStep]);

  const go = useCallback(
    (next: number) => {
      setStep(next);
      if (STEPS[next].path !== pathname) router.push(STEPS[next].path);
    },
    [pathname, router, setStep],
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

  const last = step === STEPS.length - 1;
  const nextLeavesPage = !last && STEPS[step + 1].path !== current.path;
  const nextLabel = last ? "Done" : nextLeavesPage ? `Next: ${STEPS[step + 1].title}` : "Next";

  // Card placement (sm and up): under the anchor if there's room, else above.
  // Below sm the card is a bottom sheet regardless.
  let panelStyle: React.CSSProperties | undefined;
  if (rect && typeof window !== "undefined" && window.innerWidth >= 640) {
    const below = rect.top + rect.height + 12;
    const roomBelow = window.innerHeight - below > 220;
    const left = Math.min(Math.max(rect.left, 16), window.innerWidth - 16 - 360);
    panelStyle = roomBelow ? { top: below, left } : { bottom: window.innerHeight - rect.top + 12, left };
  }

  return (
    <div className="fixed inset-0 z-[60]">
      {rect ? (
        <div
          className="pointer-events-none absolute"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            borderRadius: current.round ? 9999 : 14,
            boxShadow: "0 0 0 9999px rgba(5, 6, 12, 0.78), 0 0 0 2px rgba(167, 139, 250, 0.7)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-[#05060c]/80" />
      )}
      {arrow && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <marker id="tour-arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0,0 L10,5 L0,10 Z" fill="#a78bfa" />
            </marker>
          </defs>
          <path
            d={`M${arrow.x1},${arrow.y1} Q${(arrow.x1 + arrow.x2) / 2 + (arrow.y2 < arrow.y1 ? 28 : -28)},${(arrow.y1 + arrow.y2) / 2} ${arrow.x2},${arrow.y2}`}
            fill="none"
            stroke="#a78bfa"
            strokeWidth="2.5"
            strokeLinecap="round"
            markerEnd="url(#tour-arrowhead)"
            style={{ filter: "drop-shadow(0 0 6px rgba(167,139,250,0.6))" }}
          />
        </svg>
      )}
      {/* Click-away ends the tour, same as Skip. */}
      <button className="absolute inset-0 cursor-default" aria-label="Skip the tutorial" onClick={() => void finish()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Tutorial, step ${step + 1} of ${STEPS.length}: ${current.title}`}
        tabIndex={-1}
        className={`animate-fade-up absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] rounded-2xl border border-edge bg-surface-1 p-4 shadow-2xl shadow-black/60 outline-none sm:inset-x-auto sm:bottom-auto sm:w-[360px] sm:p-5 ${
          panelStyle ? "" : "sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2"
        }`}
        style={panelStyle}
      >
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            {step + 1} of {STEPS.length}
          </p>
          <button
            onClick={() => void finish()}
            aria-label="Close the tutorial"
            className="-mr-1.5 -mt-1.5 flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 transition hover:bg-surface-2 hover:text-white"
          >
            ✕
          </button>
        </div>
        <h2 className="font-display mt-1 text-lg font-semibold text-white">{current.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">{current.body}</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          {last ? (
            <span />
          ) : (
            <button
              onClick={() => void finish()}
              className="rounded-full border border-edge px-3.5 py-1.5 text-xs font-semibold text-zinc-300 transition hover:border-edge-strong hover:text-white"
            >
              Skip tutorial
            </button>
          )}
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={() => go(step - 1)}
                className="rounded-full border border-edge px-3.5 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-edge-strong hover:text-white"
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
