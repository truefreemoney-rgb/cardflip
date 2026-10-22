"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Active traps, oldest first (10-22): with the camera and a sheet on top both mounted, only the topmost
// one handles Tab, so the two never fight over focus.
const trapStack: symbol[] = [];

/**
 * Keep Tab / Shift+Tab inside a modal while it's open, and put focus back on
 * whatever opened it when it closes. Without this a keyboard user tabs
 * straight through the backdrop into the page behind — the modal looks open
 * but the focus ring is somewhere invisible.
 *
 * Pass the ref of the dialog panel (not the backdrop). Focus is moved into
 * the panel on mount only if nothing inside already has it (an `autoFocus`
 * close button wins).
 */
export function useFocusTrap(panelRef: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return;
    const panel = panelRef.current;
    if (!panel) return;
    const me = Symbol("focusTrap");
    trapStack.push(me);
    const opener = document.activeElement as HTMLElement | null;

    if (!panel.contains(document.activeElement)) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus({ preventScroll: true });
    }

    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab" || !panel || trapStack[trapStack.length - 1] !== me) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (current === first || !panel.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !panel.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const at = trapStack.indexOf(me);
      if (at !== -1) trapStack.splice(at, 1);
      // Return focus to the opener if it's still in the document.
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [panelRef, active]);
}
