"use client";

import { useEffect, useState } from "react";

/**
 * iOS Safari kept the landing hero at its landscape width after rotating
 * back to portrait (Chris 09-28: only the hero, everything below fine;
 * desktop WebKit does not reproduce it). After every rotation / resize we
 * re-measure the hero and, when it is wider than the page, force it to lay
 * itself out again by pinning its width for one frame and scrolling back to
 * the left edge. A style nudge, not display:none, so the entrance animations
 * do not replay. Runs twice because iOS fires orientationchange before the
 * new viewport size has settled.
 *
 * `?diag=1` shows the measured widths on screen, so a phone screenshot says
 * which box is wrong without a Mac.
 */
export default function HeroRelayout({ targetId }: { targetId: string }) {
  const [diag, setDiag] = useState<string | null>(null);

  useEffect(() => {
    const wantDiag = window.location.search.includes("diag");
    const measure = () => {
      const el = document.getElementById(targetId);
      const grid = (el?.querySelector(":scope > div") ?? null) as HTMLElement | null;
      const page = document.documentElement.clientWidth;
      const w = (e: Element | null) => (e ? Math.round(e.getBoundingClientRect().width) : -1);
      const l = (e: Element | null) => (e ? Math.round(e.getBoundingClientRect().left) : -1);
      return {
        el,
        page,
        text: [
          `vw ${window.innerWidth} page ${page} vv ${Math.round(window.visualViewport?.width ?? 0)}@${(window.visualViewport?.scale ?? 1).toFixed(2)}`,
          `html ${w(document.documentElement)} body ${w(document.body)} sw ${document.documentElement.scrollWidth}`,
          `main ${w(document.querySelector("main"))} hero ${w(el)}@${l(el)} grid ${w(grid)}@${l(grid)}`,
          `h1 ${w(document.querySelector("main h1"))}@${l(document.querySelector("main h1"))} hiw ${w(document.getElementById("how-it-works"))}`,
        ].join("\n"),
        broken: !!el && (Math.abs(w(el) - page) > 1 || el.scrollWidth > page + 1 || Math.abs(w(grid) - Math.min(page, w(grid))) > 1),
      };
    };
    const nudge = () => {
      const m = measure();
      if (wantDiag) setDiag(m.text);
      if (!m.el || !m.broken) return;
      m.el.style.width = `${m.page}px`;
      void m.el.offsetWidth;
      m.el.style.width = "";
      window.scrollTo({ left: 0 });
      if (wantDiag) setDiag(measure().text + "\n(nudged)");
    };
    let t1 = 0;
    let t2 = 0;
    const onChange = () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      t1 = window.setTimeout(nudge, 50);
      t2 = window.setTimeout(nudge, 400);
    };
    if (wantDiag) setDiag(measure().text);
    window.addEventListener("orientationchange", onChange);
    window.addEventListener("resize", onChange);
    window.visualViewport?.addEventListener("resize", onChange);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("orientationchange", onChange);
      window.removeEventListener("resize", onChange);
      window.visualViewport?.removeEventListener("resize", onChange);
    };
  }, [targetId]);

  if (!diag) return null;
  return (
    <pre className="fixed bottom-2 left-2 z-[100] max-w-[calc(100vw-1rem)] whitespace-pre-wrap rounded-lg bg-black/85 p-2 font-mono text-[11px] leading-snug text-emerald-200">
      {diag}
    </pre>
  );
}
