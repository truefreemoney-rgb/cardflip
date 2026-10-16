"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackToClose } from "@/lib/client/useBackToClose";
import { useBodyScrollLock } from "@/lib/client/useBodyScrollLock";
import { useFocusTrap } from "@/lib/client/useFocusTrap";

/**
 * The one pop-up shell (audit 10-06 E3). Phones: a bottom sheet with a drag
 * handle (swipe down or tap it to close), rounded top, max 85dvh, scrolling
 * body, safe-area padding. md+: the same panel centered as a card.
 *
 * Information pop-ups sit on a SOLID ground (`panel-solid`, owner's rule) over
 * a dimmed backdrop. Escape (capture phase, so a sheet stacked over another
 * closes alone), backdrop tap, optional Back-button close (`backId`), body
 * scroll lock, Tab trap, and focus back to the opener all live here, so a
 * caller only supplies content. Portalled to <body> so no ancestor's
 * overflow/mask/transform can clip it. z-[70] sits above the bottom tab bar.
 */
/** How far the handle must travel before letting go closes the sheet. */
const CLOSE_DRAG_PX = 56;
/** Dragged this far, the sheet closes at once — even if iOS never sends the pointer-up (Chris 10-14: "gets stuck"). */
const CLOSE_NOW_PX = 120;

/**
 * Swipe-down-to-close for any bottom sheet: pointer handlers for its handle
 * row, moving `panelRef` with the finger. Shared by Sheet and the Search page's
 * Sort & filter sheet (10-14: that one had a drawn handle that did nothing).
 */
export function useDragToClose(panelRef: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const drag = useRef<{ y: number; dy: number; done: boolean } | null>(null);
  const settle = () => {
    const d = drag.current;
    const el = panelRef.current;
    drag.current = null;
    if (!d || !el || d.done) return;
    if (d.dy > CLOSE_DRAG_PX || d.dy === 0) onClose();
    else el.style.transform = "";
  };
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      drag.current = { y: e.clientY, dy: 0, done: false };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      const el = panelRef.current;
      if (!d || !el || d.done) return;
      d.dy = Math.max(0, e.clientY - d.y);
      el.style.transform = `translateY(${d.dy}px)`;
      if (d.dy > CLOSE_NOW_PX) {
        d.done = true;
        onClose();
      }
    },
    onPointerUp: settle,
    // iOS sends a cancel instead of an up when it takes the gesture: judge the drag the same way.
    onPointerCancel: settle,
  };
}

/** The grab bar at the top of a phone sheet; spread `useDragToClose`'s handlers onto it. Hidden on md+. */
export function SheetHandle(props: ReturnType<typeof useDragToClose>) {
  return (
    <div className="flex h-7 shrink-0 cursor-grab touch-none items-center justify-center md:hidden" {...props} aria-hidden>
      <span className="h-1.5 w-10 rounded-full bg-white/25" />
    </div>
  );
}

export default function Sheet({
  onClose,
  title,
  hint,
  label,
  children,
  footer,
  role = "dialog",
  dismissOnBackdrop = true,
  backId,
  maxWidth = "max-w-md",
  panelClassName = "",
  bodyClassName = "",
  padded = true,
  z = "z-[70]",
  doneLabel,
}: {
  onClose: () => void;
  /** Header text; also the dialog's accessible name. Omit for a bare sheet with a floating close button. */
  title?: string;
  /** Line(s) under the title. */
  hint?: ReactNode;
  /** Accessible name when there is no `title`. */
  label?: string;
  children: ReactNode;
  /** Pinned under the scrolling body (buttons), safe-area padded. */
  footer?: ReactNode;
  role?: "dialog" | "alertdialog";
  dismissOnBackdrop?: boolean;
  /** History id: the Android/iOS Back gesture closes the sheet. */
  backId?: string;
  maxWidth?: string;
  panelClassName?: string;
  bodyClassName?: string;
  /** Body padding on (default). Turn off for edge-to-edge content. */
  padded?: boolean;
  z?: string;
  /** A worded close top right ("Done") in place of the X. */
  doneLabel?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(panelRef);
  useBodyScrollLock();
  useBackToClose(backId ?? "sheet", onClose, Boolean(backId));

  // Escape: capture + stopPropagation so only the topmost sheet closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // iOS keeps a fixed overlay under the keyboard: ride up by its height.
  const [kbd, setKbd] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setKbd(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // Entrance: slide up on phones, fade-rise on md+. Skipped for reduced motion.
  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof el.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const phone = !window.matchMedia("(min-width: 768px)").matches;
    el.animate(
      phone
        ? [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }]
        : [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: phone ? 260 : 200, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
  }, []);

  const handle = useDragToClose(panelRef, onClose);

  if (typeof document === "undefined") return null;

  const close = doneLabel ? (
    <button
      type="button"
      onClick={onClose}
      className="flex h-11 shrink-0 items-center rounded-full px-3 text-sm font-semibold text-brand-300 transition hover:bg-white/10 hover:text-white"
    >
      {doneLabel}
    </button>
  ) : (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-300 transition hover:bg-white/10 hover:text-white"
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M5 5l10 10M15 5l-10 10" strokeLinecap="round" />
      </svg>
    </button>
  );

  return createPortal(
    <div
      className={`fixed inset-0 ${z} flex items-end justify-center bg-black/80 backdrop-blur-sm md:items-center md:p-4`}
      style={kbd > 0 ? { paddingBottom: kbd } : undefined}
      onClick={(e) => {
        // Stacked sheets live in React trees of their openers: never let a
        // click here bubble up to a parent's own backdrop handler.
        e.stopPropagation();
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label}
        tabIndex={-1}
        // Keyboard up (10-08, Chris: the category sheet's button sat off screen in portrait): the panel may not be
        // taller than the space the keyboard leaves, so its buttons stay reachable and the body scrolls inside.
        style={kbd > 0 ? { maxHeight: `calc(100dvh - ${kbd + 8}px)` } : undefined}
        className={`panel-solid relative flex max-h-[85dvh] w-full ${maxWidth} flex-col overflow-hidden rounded-t-3xl border border-b-0 shadow-2xl shadow-black/60 outline-none md:rounded-2xl md:border-b ${panelClassName}`}
      >
        <SheetHandle {...handle} />
        {title ? (
          <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-1 md:pt-5">
            <div className="min-w-0 pt-2">
              <p id={titleId} className="font-display text-lg font-semibold text-white">
                {title}
              </p>
              {hint && <div className="mt-0.5 text-sm text-zinc-400">{hint}</div>}
            </div>
            <span className="-mr-2">{close}</span>
          </div>
        ) : (
          <div className="absolute right-2 top-2 z-10">{close}</div>
        )}
        <div
          className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${
            padded ? `px-5 pt-3 ${footer ? "pb-3" : "pb-[max(1.25rem,env(safe-area-inset-bottom))]"}` : ""
          } ${bodyClassName}`}
        >
          {children}
        </div>
        {footer && <div className="shrink-0 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-1">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
