"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { useFocusTrap } from "@/lib/client/useFocusTrap";
import { markTourSeen, takeTourReplay } from "@/lib/client/tour";

/**
 * First-login tutorial: four coach marks over the real scanner page. A
 * spotlight (box-shadow cut-out, so the element underneath stays live and
 * un-blurred) sits on the anchor, the card sits beside it — or at the
 * bottom of a phone screen. Steps whose anchor isn't on the page (the
 * editor only exists after a scan) run as a centred card.
 *
 * Shown once per account (users.tour_seen_at, stamped on Done or Skip);
 * the account page's Replay re-runs it through sessionStorage. Only on
 * /app, only once the session is ready and the wall isn't up.
 */

interface Step {
  anchor?: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    anchor: "capture",
    title: "Scan a card",
    body: "Point the camera at a card and tap Capture. CardFlip names it, finds the printing and prices it from live sales.",
  },
  {
    title: "Check, then sell",
    body: "Every scan opens an editor. Confirm it's the card in your hand with Verify match, then Publish on eBay — photo, title and price included.",
  },
  {
    anchor: "tab-inventory",
    title: "Inventory",
    body: "Everything you've scanned lives here: in play, listed, ended, sold. Tap a price to change it, even on a live listing.",
  },
  {
    anchor: "tab-watchlist",
    title: "Watchlist",
    body: "Cards you don't own yet. Watch them and CardFlip emails you when the price dips.",
  },
];

const PAD = 6;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function findAnchor(name: string | undefined): HTMLElement | null {
  if (!name || typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
}

export default function TourOverlay() {
  const { user, status, setUser } = useSession();
  const pathname = usePathname();
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const open = step !== null;

  const onScanner = pathname === "/app";
  const eligible = status === "ready" && !!user && user.appAccess !== false && onScanner;

  // Start: owed by the account, or a replay requested from the account page.
  useEffect(() => {
    if (!eligible || open) return;
    const replay = takeTourReplay();
    if (replay || user?.tourSeenAt == null) {
      // Let the page paint its anchors first.
      const t = window.setTimeout(() => setStep(0), 400);
      return () => window.clearTimeout(t);
    }
  }, [eligible, open, user?.tourSeenAt]);

  // Off the scanner the tour hides (nothing stamped) and resumes on return.
  const current = open && onScanner ? STEPS[step] : null;

  // Measure the anchor on every step, and follow it through resizes/scrolls.
  useLayoutEffect(() => {
    if (!current) return;
    const el = findAnchor(current.anchor);
    if (!el) {
      const t = window.setTimeout(() => setRect(null), 0);
      return () => window.clearTimeout(t);
    }
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
    };
    // After the scroll settles, and off the effect body (react-hooks rule).
    // A timeout, not rAF: frames pause in background tabs.
    const t = window.setTimeout(measure, 0);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [current]);

  const finish = useCallback(async () => {
    setStep(null);
    if (user && user.tourSeenAt == null) {
      setUser({ ...user, tourSeenAt: Date.now() });
      await markTourSeen();
    }
  }, [user, setUser]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void finish();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, finish]);

  useFocusTrap(panelRef, open);

  if (!current || step === null) return null;

  const last = step === STEPS.length - 1;
  const radius = current.anchor?.startsWith("tab-") || current.anchor === "capture" ? 9999 : 14;

  // Card placement (sm and up): under the anchor if there's room, else above.
  // Below sm the card is a bottom sheet regardless.
  let panelStyle: React.CSSProperties | undefined;
  if (rect && typeof window !== "undefined" && window.innerWidth >= 640) {
    const below = rect.top + rect.height + 12;
    const roomBelow = window.innerHeight - below > 220;
    const left = Math.min(Math.max(rect.left, 16), window.innerWidth - 16 - 360);
    panelStyle = roomBelow
      ? { top: below, left }
      : { bottom: window.innerHeight - rect.top + 12, left };
  }

  return (
    <div className="fixed inset-0 z-[60]" aria-hidden={false}>
      {rect ? (
        <div
          className="pointer-events-none absolute"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            borderRadius: radius,
            boxShadow: "0 0 0 9999px rgba(5, 6, 12, 0.78), 0 0 0 2px rgba(167, 139, 250, 0.7)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-[#05060c]/80" />
      )}
      {/* Click-away catcher; the anchor's own clicks still reach it because
          the spotlight box has no pointer events and sits above this. */}
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
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          {step + 1} of {STEPS.length}
        </p>
        <h2 className="font-display mt-1 text-lg font-semibold text-white">{current.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">{current.body}</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <button onClick={() => void finish()} className="text-xs text-zinc-500 transition hover:text-zinc-300">
            {last ? "" : "Skip"}
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
                className="rounded-full border border-edge px-3.5 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-edge-strong hover:text-white"
              >
                Back
              </button>
            )}
            <button
              autoFocus
              onClick={() => (last ? void finish() : setStep(step + 1))}
              className="rounded-full bg-brand-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-400"
            >
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
