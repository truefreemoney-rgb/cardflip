"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { apiFetch, apiPath } from "@/lib/client/basePath";
import type { PackageDay, PackageRow } from "@/lib/socialTiktok";
import { etDay } from "@/lib/time";

/**
 * /admin/social — "TikTok — post by hand" (Chris 09-30). TikTok refused the
 * developer app for production, so the robot no longer posts there. Every
 * evening it builds tomorrow's three videos with their captions
 * (lib/socialTiktok.ts); this card hands them over, one row per post time.
 *
 * Share Video is the one obvious action per row. On iOS Safari a long await
 * between the tap and navigator.share() loses the user gesture, so the MP4 is
 * fetched into a File AHEAD of the tap (when the row scrolls into view), and
 * the tap itself copies the caption (TikTok takes no text from the share
 * sheet) and calls navigator.share({ files }) with nothing awaited before it.
 * Where the browser cannot share files, or the fetch failed, the primary
 * button becomes Download Video (which is also on offer while the fetch runs,
 * so a slow phone connection never leaves the row with nothing to tap).
 *
 * The Blob host may not send CORS headers: the fetch tries the video URL
 * directly and falls back to the owner-only same-origin stream
 * (/api/admin/social/tiktok/video). Each try has a deadline, because a stalled
 * socket on a phone never rejects (lib/client/basePath.ts apiFetch).
 *
 * The page is rendered on the server once, and an installed iPhone PWA is
 * resumed from memory, not reloaded: coming back after midnight, or to rows the
 * night render had not finished, the card asks the server for a fresh render.
 */
type Slot = PackageRow["slot"];

/** How long each try of the MP4 fetch gets before it gives way to the next (a 26s video is ~8 MB). */
const DIRECT_MS = 30_000;
const PROXY_MS = 60_000;
/** Coming back to the page after this long away refreshes it, whatever the rows say. */
const AWAY_REFRESH_MS = 5 * 60_000;

function videoRoute(day: string, slot: Slot, download = false): string {
  return apiPath(`/api/admin/social/tiktok/video?slot=${slot}&day=${day}${download ? "&download=1" : ""}`);
}

/** Copy now, inside the tap: execCommand works synchronously in Safari; the async clipboard call is the fallback. Never awaited by the caller. */
function copyNow(text: string): boolean {
  let ok = false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = document.execCommand("copy");
    document.body.removeChild(ta);
  } catch {
    ok = false;
  }
  if (!ok) {
    try {
      void navigator.clipboard.writeText(text).catch(() => {});
      ok = true;
    } catch {
      /* clipboard blocked; the caption is on screen to select */
    }
  }
  return ok;
}

/** One GET of the MP4 that gives up after `ms` (or when `outer` aborts), body included. */
async function getWithin(url: string, ms: number, outer: AbortSignal): Promise<Blob> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  const onOuter = () => ac.abort();
  outer.addEventListener("abort", onOuter);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ac.signal });
    if (!res.ok) throw new Error(`video ${res.status}`);
    const blob = await res.blob();
    if (!blob.size) throw new Error("empty video");
    return blob;
  } finally {
    clearTimeout(timer);
    outer.removeEventListener("abort", onOuter);
  }
}

async function fetchVideoFile(day: string, row: PackageRow, signal: AbortSignal): Promise<File> {
  let blob: Blob;
  try {
    blob = await getWithin(row.url!, DIRECT_MS, signal);
  } catch (err) {
    if (signal.aborted) throw err;
    blob = await getWithin(videoRoute(day, row.slot), PROXY_MS, signal);
  }
  return new File([blob], `cardflip-tiktok-${day}-${row.slot}.mp4`, { type: "video/mp4" });
}

const noSubscribe = () => () => {};
/** A fine pointer (mouse) = a computer, where Share with a file is not the hand-over; read on the client only. */
const isDesktop = () => typeof window !== "undefined" && !window.matchMedia("(pointer: coarse)").matches;

const btn = "inline-flex min-h-10 items-center justify-center rounded-full border border-edge px-4 text-sm font-medium text-zinc-200 hover:text-white disabled:opacity-40";
const primary = "inline-flex min-h-11 w-full items-center justify-center rounded-full bg-brand-500 px-5 text-base font-semibold text-white disabled:opacity-50";

function Row({ day, row }: { day: string; row: PackageRow }) {
  const [posted, setPosted] = useState(row.posted);
  const [file, setFile] = useState<File | null>(null);
  const [fetching, setFetching] = useState<"idle" | "loading" | "failed">("idle");
  // A mouse-and-keyboard computer never fetches ahead (10-07, Chris: the Social tab was slow to open AND to leave):
  // only a phone needs the MP4 in hand before the tap for navigator.share; a desktop gets Download Video at once.
  const desktop = useSyncExternalStore(noSubscribe, isDesktop, () => false);
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLElement>(null);
  const ready = row.state === "ready" && row.url && row.caption;

  // Fetch the MP4 when the row comes into view, so the tap has a File in hand.
  useEffect(() => {
    if (!ready || posted || file || fetching !== "idle" || isDesktop()) return;
    const el = box.current;
    const ac = new AbortController();
    let started = false;
    let finished = false;
    const go = () => {
      started = true;
      setFetching("loading");
      fetchVideoFile(day, row, ac.signal)
        .then((f) => {
          if (ac.signal.aborted) return;
          finished = true;
          setFile(f);
          setCanShare(typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [f] }));
          setFetching("idle");
        })
        .catch(() => {
          if (ac.signal.aborted) return;
          finished = true;
          setFetching("failed");
        });
    };
    let io: IntersectionObserver | null = null;
    if (!el || typeof IntersectionObserver === "undefined") go();
    else {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io?.disconnect();
            go();
          }
        },
        { rootMargin: "300px" },
      );
      io.observe(el);
    }
    return () => {
      ac.abort();
      io?.disconnect();
      // Abandoned mid-fetch (Mark Posted, then Undo, before the MP4 arrived): the next run must be able to start over, not find "loading" for ever.
      if (started && !finished) setFetching("idle");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, posted, day, row.slot, row.url]);

  function share() {
    if (!file || !row.caption) return;
    // Nothing is awaited before navigator.share(): the gesture must still be alive.
    copyNow(row.caption);
    setNote("Caption copied. Pick TikTok, then paste it as the caption.");
    navigator.share({ files: [file] }).catch((err: unknown) => {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setNote("Sharing did not work. Use Download Video, then paste the caption.");
    });
  }

  function copyCaption() {
    if (!row.caption) return;
    copyNow(row.caption);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function mark(on: boolean) {
    setBusy(true);
    try {
      const res = await apiFetch("/api/admin/social/tiktok", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slot: row.slot, day, posted: on }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPosted(on);
      setNote(null);
    } catch (err) {
      setNote(err instanceof Error ? `Could not save that: ${err.message}` : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  // Posted wins over "not made": a video posted by hand from a file the card never registered (09-30's three) is still posted.
  if (posted) {
    return (
      <article className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-surface-2 p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">
            {row.time} <span className="ml-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">Posted</span>
          </p>
          {row.title && <p className="truncate text-xs text-zinc-500">{row.title}</p>}
        </div>
        <button type="button" onClick={() => mark(false)} disabled={busy} className="shrink-0 text-xs text-brand-300 hover:underline disabled:opacity-40">
          Undo
        </button>
      </article>
    );
  }

  if (!ready) {
    return (
      <article className="rounded-xl border border-edge bg-surface-2 p-3">
        <p className="text-sm font-medium text-white">{row.time}</p>
        <p className="mt-0.5 text-xs text-zinc-400">{row.note}</p>
      </article>
    );
  }

  const size = row.bytes ? `${(row.bytes / 1e6).toFixed(1)} MB` : null;
  // The one primary action: share the fetched file, wait for it, or (fetch failed / cannot share files) download it.
  const mode = file && canShare ? "share" : !desktop && (fetching === "loading" || (fetching === "idle" && !file)) ? "loading" : "download";
  return (
    <article ref={box} className="rounded-xl border border-edge bg-surface-2 p-3">
      <div className="flex gap-3">
        <video
          src={`${row.url}#t=0.1`}
          muted
          playsInline
          controls
          preload="metadata"
          aria-label={`Preview of the ${row.time} video`}
          className="aspect-[9/16] w-24 shrink-0 rounded-lg bg-black object-contain"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">{row.time}</p>
          <p className="break-words text-sm text-zinc-200">{row.title}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {Math.round(row.seconds)}s{size ? ` · ${size}` : ""}
          </p>
          <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-line break-words rounded-lg bg-black/25 p-2 text-xs text-zinc-300">{row.caption}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {mode === "share" ? (
          <button type="button" onClick={share} className={primary}>
            Share Video
          </button>
        ) : mode === "loading" ? (
          <button type="button" disabled className={primary}>
            Getting Video…
          </button>
        ) : (
          <a href={videoRoute(day, row.slot, true)} download onClick={() => copyNow(row.caption!)} className={primary}>
            Download Video
          </a>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={copyCaption} className={btn}>
            {copied ? "Copied" : "Copy Caption"}
          </button>
          {mode !== "download" ? (
            <a href={videoRoute(day, row.slot, true)} download onClick={() => copyNow(row.caption!)} className={btn}>
              Download Video
            </a>
          ) : null}
          <button type="button" onClick={() => mark(true)} disabled={busy} className={btn}>
            Mark Posted
          </button>
        </div>
        {note && <p className="text-xs text-zinc-300">{note}</p>}
      </div>
    </article>
  );
}

function Section({ title, pkg }: { title: string; pkg: PackageDay }) {
  const ready = pkg.rows.filter((r) => r.state === "ready").length;
  const posted = pkg.rows.filter((r) => r.posted).length;
  return (
    <div className="mt-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-sm font-semibold text-white">
          {title} <span className="font-normal text-zinc-400">· {pkg.label}</span>
        </h3>
        <p className="text-xs text-zinc-500">
          {posted === pkg.rows.length ? `All ${posted} posted` : `${ready} of ${pkg.rows.length} ready${posted ? ` · ${posted} posted` : ""}`}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {pkg.rows.map((r) => (
          // Row copies row.posted into state once: a change from the server (marked on another device) is a new row.
          <Row key={`${pkg.day}-${r.slot}-${r.url ?? r.state}-${r.posted ? "posted" : "open"}`} day={pkg.day} row={r} />
        ))}
      </div>
    </div>
  );
}

export default function TikTokPackage({ tomorrow, today, handle }: { tomorrow: PackageDay; today: PackageDay; handle: string }) {
  const router = useRouter();
  // Back from the home screen: the split into Tomorrow and Today, and every "ready by about 9:30pm" note, were true when the server drew them.
  useEffect(() => {
    let hiddenAt: number | null = null;
    const back = () => {
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      const newDay = etDay() !== today.day;
      const waiting = [tomorrow, today].some((p) => p.rows.some((r) => r.state !== "ready"));
      if (newDay || waiting || away > AWAY_REFRESH_MS) router.refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else back();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) back();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router, today, tomorrow]);
  return (
    <section className="mb-4 rounded-2xl border border-edge bg-surface-1 p-4" aria-labelledby="tiktok-hand">
      <h2 id="tiktok-hand" className="text-lg font-semibold text-white">
        TikTok — post by hand
      </h2>
      <p className="mt-1 text-sm text-zinc-400">
        TikTok would not approve automatic posting, so the robot builds the videos and you post them to @{handle}. Tap Share Video, pick TikTok, paste the caption (it is already copied), then Mark Posted.
      </p>
      <Section title="Tomorrow" pkg={tomorrow} />
      <Section title="Today" pkg={today} />
    </section>
  );
}
