"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { HEAT_OFF_KEY, MAX_EVENTS, TAPS_PER_VIEW, cleanLabel, pageKey } from "@/lib/heatmap";
import { inPreviewFrame } from "@/lib/client/framed";

/**
 * Heat map recorder (10-18, lib/heatmap.ts). On public and app pages it notes
 * each page view in order, where on the page people tap (position and the
 * button's name, never anything typed) and how far down they scroll, and
 * sends them to /api/heat in small batches. The tab's id lives in
 * sessionStorage only: it ends when the tab closes, is never a cookie, and is
 * never joined to an account, so it shows the path through one visit and
 * nothing more. Admin pages and the admin preview frame never record.
 */

type Ev =
  | { t: "v"; s: number; p: string; w: number }
  | { t: "c"; s: number; p: string; w: number; x: number; y: number; h: number; f: 0 | 1; l: string }
  | { t: "d"; s: number; d: number };

const TAB_KEY = "cf_heat_tab";
const SEQ_KEY = "cf_heat_seq";

let tab = "";
let seq = -1;
let path = "";
let taps = 0;
let depth = 0;
let sentDepth = 0;
let queue: Ev[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function tabId(): string {
  if (tab) return tab;
  try {
    tab = sessionStorage.getItem(TAB_KEY) ?? "";
    if (!/^[a-z0-9]{12}$/.test(tab)) {
      tab = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
      sessionStorage.setItem(TAB_KEY, tab);
    }
  } catch {
    tab = tab || Math.random().toString(16).slice(2, 14).padEnd(12, "0");
  }
  return tab;
}

function nextSeq(): number {
  let n = seq + 1;
  try {
    // A reload in the same tab continues the count, so the path reads on.
    n = Math.max(n, Number(sessionStorage.getItem(SEQ_KEY) ?? -1) + 1);
    sessionStorage.setItem(SEQ_KEY, String(n));
  } catch {
    // Private mode: this page load's own count.
  }
  return n;
}

function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (seq >= 0 && depth > sentDepth) {
    queue.push({ t: "d", s: seq, d: depth });
    sentDepth = depth;
  }
  if (queue.length === 0) return;
  const body = JSON.stringify({ tab: tabId(), ev: queue.slice(0, MAX_EVENTS) });
  queue = [];
  try {
    if (!navigator.sendBeacon?.("/api/heat", new Blob([body], { type: "application/json" }))) {
      void fetch("/api/heat", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
    }
  } catch {
    // Never let recording touch the page.
  }
}

function later() {
  if (!timer) timer = setTimeout(flush, 10_000);
}

function docHeight(): number {
  const d = document.documentElement;
  return Math.max(d.scrollHeight, document.body?.scrollHeight ?? 0, window.innerHeight);
}

function onScroll() {
  const d = Math.min(100, Math.round(((window.scrollY + window.innerHeight) / docHeight()) * 100));
  if (d > depth) {
    depth = d;
    later();
  }
}

const TAPPABLE = "a,button,[role=button],[role=tab],[role=link],[role=menuitem],[role=switch],summary,label,select,input,textarea";

/** The name of what was tapped: its label or visible text, never a typed value. "" = tapped nothing tappable. */
function labelOf(target: EventTarget | null): string {
  const el = target instanceof Element ? target.closest(TAPPABLE) : null;
  if (!el) return "";
  const aria = el.getAttribute("aria-label") || el.getAttribute("title");
  if (aria) return cleanLabel(aria);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el instanceof HTMLInputElement && /^(submit|button)$/.test(el.type)) return cleanLabel(el.value);
    return cleanLabel(`Text box: ${el.placeholder || el.name || el.type}`);
  }
  if (el instanceof HTMLSelectElement) return cleanLabel(`Menu: ${el.name || "choose"}`);
  const text = (el as HTMLElement).innerText?.split("\n").find((s) => s.trim()) ?? "";
  if (text) return cleanLabel(text);
  const img = el.querySelector("img[alt]");
  return cleanLabel(img?.getAttribute("alt") || el.tagName.toLowerCase());
}

/** Inside a fixed or sticky bar (tab bar, header): drawn where it sits on the screen, not on the page. */
function onFixedBar(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null;
  for (let i = 0; el && i < 12; i++, el = el.parentElement) {
    const pos = getComputedStyle(el).position;
    if (pos === "fixed" || pos === "sticky") return true;
  }
  return false;
}

function onTap(e: PointerEvent) {
  if (seq < 0 || taps >= TAPS_PER_VIEW || !e.isPrimary) return;
  taps++;
  const w = window.innerWidth;
  const fixed = onFixedBar(e.target);
  queue.push({
    t: "c",
    s: seq,
    p: path,
    w,
    x: Math.round((Math.min(Math.max(e.clientX, 0), w) / w) * 1000),
    y: Math.round(fixed ? e.clientY : e.clientY + window.scrollY),
    h: fixed ? window.innerHeight : docHeight(),
    f: fixed ? 1 : 0,
    l: labelOf(e.target),
  });
  if (queue.length >= 20) flush();
  else later();
}

function onHide() {
  if (document.visibilityState === "hidden") flush();
}

let listening = false;

/** This device switched itself off (?heat=off, kept; ?heat=on undoes it), or a browser driven by a script. */
function switchedOff(): boolean {
  try {
    if (navigator.webdriver) return true;
    const want = new URLSearchParams(window.location.search).get("heat");
    if (want === "off") localStorage.setItem(HEAT_OFF_KEY, "1");
    if (want === "on") localStorage.removeItem(HEAT_OFF_KEY);
    return localStorage.getItem(HEAT_OFF_KEY) === "1";
  } catch {
    return false;
  }
}

export default function HeatPing() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname || inPreviewFrame() || switchedOff()) return;
    // The same address again within this page load is the same view (a remount, React's dev double effect), not a new one.
    if (seq >= 0 && pathname === path) return;
    flush();
    if (!pageKey(pathname)) {
      // A page that is not mapped: its taps must not land on the page before it.
      seq = -1;
      return;
    }
    seq = nextSeq();
    path = pathname;
    taps = 0;
    depth = 0;
    sentDepth = 0;
    queue.push({ t: "v", s: seq, p: pathname, w: window.innerWidth });
    later();
    onScroll();
    if (!listening) {
      listening = true;
      document.addEventListener("pointerdown", onTap, { capture: true, passive: true });
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("pagehide", flush);
      document.addEventListener("visibilitychange", onHide);
    }
  }, [pathname]);
  return null;
}
