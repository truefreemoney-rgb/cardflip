"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, apiPath } from "@/lib/client/basePath";
import type { PackageDay, PackageRow } from "@/lib/socialTiktok";

/**
 * /admin/social — "TikTok — Post by Hand" (Chris 09-30). TikTok refused the
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
 * button becomes Download Video.
 *
 * The Blob host may not send CORS headers: the fetch tries the video URL
 * directly and falls back to the owner-only same-origin stream
 * (/api/admin/social/tiktok/video).
 */
type Slot = PackageRow["slot"];

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

async function fetchVideoFile(day: string, row: PackageRow): Promise<File> {
  const name = `cardflip-tiktok-${day}-${row.slot}.mp4`;
  const get = async (url: string) => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`video ${res.status}`);
    const blob = await res.blob();
    if (!blob.size) throw new Error("empty video");
    return new File([blob], name, { type: "video/mp4" });
  };
  try {
    return await get(row.url!);
  } catch {
    return await get(videoRoute(day, row.slot));
  }
}

const btn = "inline-flex min-h-10 items-center justify-center rounded-full border border-edge px-4 text-sm font-medium text-zinc-200 hover:text-white disabled:opacity-40";
const primary = "inline-flex min-h-11 w-full items-center justify-center rounded-full bg-brand-500 px-5 text-base font-semibold text-white disabled:opacity-50";

function Row({ day, row }: { day: string; row: PackageRow }) {
  const [posted, setPosted] = useState(row.posted);
  const [file, setFile] = useState<File | null>(null);
  const [fetching, setFetching] = useState<"idle" | "loading" | "failed">("idle");
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLElement>(null);
  const ready = row.state === "ready" && row.url && row.caption;

  // Fetch the MP4 when the row comes into view, so the tap has a File in hand.
  useEffect(() => {
    if (!ready || posted || file || fetching !== "idle") return;
    const el = box.current;
    let cancelled = false;
    const go = () => {
      setFetching("loading");
      fetchVideoFile(day, row)
        .then((f) => {
          if (cancelled) return;
          setFile(f);
          setCanShare(typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [f] }));
          setFetching("idle");
        })
        .catch(() => !cancelled && setFetching("failed"));
    };
    if (!el || typeof IntersectionObserver === "undefined") {
      go();
      return () => {
        cancelled = true;
      };
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          go();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
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

  if (!ready) {
    return (
      <article className="rounded-xl border border-edge bg-surface-2 p-3">
        <p className="text-sm font-medium text-white">{row.time}</p>
        <p className="mt-0.5 text-xs text-zinc-400">{row.note}</p>
      </article>
    );
  }

  if (posted) {
    return (
      <article className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-surface-2 p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">
            {row.time} <span className="ml-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">Posted</span>
          </p>
          <p className="truncate text-xs text-zinc-500">{row.title}</p>
        </div>
        <button type="button" onClick={() => mark(false)} disabled={busy} className="shrink-0 text-xs text-brand-300 hover:underline disabled:opacity-40">
          Undo
        </button>
      </article>
    );
  }

  const size = row.bytes ? `${(row.bytes / 1e6).toFixed(1)} MB` : null;
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
        {file && canShare ? (
          <button type="button" onClick={share} className={primary}>
            Share Video
          </button>
        ) : fetching === "loading" || (fetching === "idle" && !file) ? (
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
          {file && canShare ? (
            <a href={videoRoute(day, row.slot, true)} download className={btn}>
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
          {ready} of {pkg.rows.length} ready{posted ? ` · ${posted} posted` : ""}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {pkg.rows.map((r) => (
          <Row key={`${pkg.day}-${r.slot}-${r.url ?? r.state}`} day={pkg.day} row={r} />
        ))}
      </div>
    </div>
  );
}

export default function TikTokPackage({ tomorrow, today, handle }: { tomorrow: PackageDay; today: PackageDay; handle: string }) {
  return (
    <section className="mb-4 rounded-2xl border border-edge bg-surface-1 p-4" aria-labelledby="tiktok-hand">
      <h2 id="tiktok-hand" className="text-lg font-semibold text-white">
        TikTok — Post by Hand
      </h2>
      <p className="mt-1 text-sm text-zinc-400">
        TikTok would not approve automatic posting, so the robot builds the videos and you post them to @{handle}. Tap Share Video, pick TikTok, paste the caption (it is already copied), then Mark Posted.
      </p>
      <Section title="Tomorrow" pkg={tomorrow} />
      <Section title="Today" pkg={today} />
    </section>
  );
}
