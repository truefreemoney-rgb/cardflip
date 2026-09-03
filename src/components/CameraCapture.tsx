"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/client/useFocusTrap";
import CardImage from "@/components/CardImage";
import { formatMoney, pickPrice } from "@/lib/listing";
import {
  fxCapture,
  fxMatch,
  fxMiss,
  primeScanFx,
  revealTier,
  scanFxEnabled,
  setScanFxEnabled,
  type RevealTier,
} from "@/lib/client/scanFx";
import type { ScanItem } from "@/lib/types";

interface Props {
  /**
   * The queue item created by this modal's most recent capture. The scan runs
   * in the page's pump loop, not here — threading the item back in is what
   * lets the viewfinder show "Identifying… → match + confidence" live while
   * the seller lines up the next card.
   */
  lastScan?: ScanItem | null;
  /** Everything identified so far this session — the running score in the HUD. */
  tally?: { count: number; value: number } | null;
  onCapture: (file: File) => void;
  onClose: () => void;
}

/**
 * Room between the guide and the viewfinder's edge for the ✕ / torch /
 * sound column, so the brackets never sit under a button (Chris, 09-02,
 * phone: "everything overlaps, you can't see the square scan lines").
 */
const GUIDE_GUTTER_PX = 64;

interface GuideRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The card guide, in both spaces at once: where the viewfinder draws it
 * (display px, relative to the video element's box) and the matching region
 * of the raw frame (video px) that the capture crops. One function so the
 * two can't drift.
 *
 * The guide is 82% of the displayed video's height at 63:88 and centered,
 * unless that would run under the HUD's button column — then it's narrowed
 * to leave GUIDE_GUTTER_PX each side and the height follows. object-contain
 * letterboxing is accounted for, so a pillarboxed phone stream maps 1:1.
 * Null until the element is laid out and the stream has a size.
 */
function guideGeometry(
  video: HTMLVideoElement,
): { display: GuideRect; video: GuideRect } | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const ew = video.clientWidth;
  const eh = video.clientHeight;
  if (!vw || !vh || !ew || !eh) return null;
  const scale = Math.min(ew / vw, eh / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const dx = (ew - dw) / 2;
  const dy = (eh - dh) / 2;
  let gh = dh * 0.82;
  let gw = gh * (63 / 88);
  const maxW = Math.min(dw, Math.max(dw * 0.5, ew - 2 * GUIDE_GUTTER_PX));
  if (gw > maxW) {
    gw = maxW;
    gh = gw * (88 / 63);
  }
  const gx = dx + (dw - gw) / 2;
  const gy = dy + (dh - gh) / 2;
  return {
    display: { x: gx, y: gy, w: gw, h: gh },
    video: { x: (gx - dx) / scale, y: (gy - dy) / scale, w: gw / scale, h: gh / scale },
  };
}

/** Guide in video px, falling back to the centered 82% rect if not laid out. */
function guideInVideo(video: HTMLVideoElement): GuideRect {
  const g = guideGeometry(video);
  if (g) return g.video;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const h = vh * 0.82;
  const w = Math.min(vw, h * (63 / 88));
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}

/**
 * Live camera capture, so a stack of cards can be scanned without ever
 * leaving the page.
 *
 * The stream stays open across shots on purpose — the workflow is "capture,
 * swap card, capture", and reopening the camera per card would make the phone
 * permission prompt the slowest part of scanning. Each shot becomes a File
 * and feeds the exact pipeline uploads use; vision/OCR never know the
 * difference.
 *
 * There is no auto-capture. One was built (frame-steadiness sampling with a
 * stack of card-likeness gates) and removed on 09-03 after it kept firing on
 * a real desk — keyboard, hand, monitor — each costing a paid scan. Chris:
 * "capture button is where it's at for speed". Don't rebuild without asking.
 */
export default function CameraCapture({ lastScan, tally, onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by "Try again" to re-run the getUserMedia effect after a denial.
  const [retryKey, setRetryKey] = useState(0);
  // The escape hatch when the camera won't open: a file picker right in the
  // modal, so a denied permission doesn't dead-end the scanning flow.
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [captured, setCaptured] = useState(0);
  const [flash, setFlash] = useState(false);
  // Lazy initialiser: read the stored preference once, on the client (the
  // modal only ever mounts client-side, after a tap).
  const [fxOn, setFxOn] = useState(() => scanFxEnabled());
  // "unavailable" hides the button entirely — torches only exist on phone
  // back cameras, and a control that can't work is worse than none.
  const [torch, setTorch] = useState<"unavailable" | "off" | "on">(
    "unavailable",
  );
  // Where the guide is drawn, in the video element's box. Measured, not
  // CSS-sized, so the sampler and the crop read exactly what's on screen.
  const [guide, setGuide] = useState<GuideRect | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !ready) return;
    const measure = () => setGuide(guideGeometry(video)?.display ?? null);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(video);
    // 'resize' on a video fires when the stream's dimensions change.
    video.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      ro.disconnect();
      video.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [ready]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // "environment" is the phone's back camera; desktops have no facing
          // and fall back to whatever webcam exists. The high ideal size is
          // for the collector number — it's the smallest print on the card,
          // and the vision client downscales to its own budget regardless.
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1920 },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        setReady(true);

        // lib.dom doesn't type torch yet, but Android Chrome reports it in
        // the track capabilities; anything that doesn't gets no button.
        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as
          | (MediaTrackCapabilities & { torch?: boolean })
          | undefined;
        if (capabilities?.torch) setTorch("off");
      } catch (err) {
        // NotAllowedError = the user (or a site setting) blocked the camera —
        // "allow it in the prompt" is wrong advice there, the prompt won't
        // reappear until the site permission is reset.
        const denied = err instanceof DOMException && err.name === "NotAllowedError";
        const missing = err instanceof DOMException && err.name === "NotFoundError";
        setError(
          denied
            ? "Camera access is blocked for this site. Turn it on in your browser's site settings (the icon by the address bar), or scan from photos instead."
            : missing
              ? "No camera found on this device — you can scan from photos instead."
              : "Couldn't open the camera — you can scan from photos instead.",
        );
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [retryKey]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;

    const next = torch === "off";
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorch(next ? "on" : "off");
    } catch {
      // The capability probe lied (some Android WebViews do) — drop the button
      // rather than leaving a toggle that silently does nothing.
      setTorch("unavailable");
    }
  }, [torch]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    // videoWidth is 0 until the stream delivers its first frame.
    if (!video || video.videoWidth === 0) return;

    // Crop to the guide, not the whole sensor frame. The viewfinder dims
    // everything outside the card-shaped guide, so the seller frames the card
    // IN the guide — saving the full frame put a small card in a sea of table
    // (Chris, 09-02: "looks like I'm much closer than the photo comes out").
    // Same guide geometry as the viewfinder (guideInVideo), 1:1 — no margin. There was a 5% one so a card nosing
    // past a bracket kept its edge; it read as the photo coming out ~10%
    // farther than what was framed (Chris, 09-03: "make it 10% closer").
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const { x: gx, y: gy, w: gw, h: gh } = guideInVideo(video);
    const pad = 0;
    const sx = Math.max(0, gx - pad);
    const sy = Math.max(0, gy - pad);
    const sw = Math.min(vw - sx, gw + pad * 2);
    const sh = Math.min(vh - sy, gh + pad * 2);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    canvas.getContext("2d")?.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(
          new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" }),
        );
        setCaptured((count) => count + 1);
        setFlash(true);
        setTimeout(() => setFlash(false), 150);
        fxCapture();
      },
      "image/jpeg",
      0.92,
    );
  }, [onCapture]);

  const bracket = "border-brand-400";
  // Sweep while the last capture is still identifying; off once a match is
  // showing, so the chip gets the eye.
  const identifying =
    lastScan?.status === "queued" || lastScan?.status === "scanning";
  const sweeping = ready && identifying;

  // The moment of the match: chime + haptic once per scan, sized to the
  // card's value. A grail also blooms a holo burst behind the guide — the
  // one-shot CSS animation ends at opacity 0, so it needs no timer; keying
  // it on the scan id replays it for the next grail.
  const revealed = lastScan && !identifying ? lastScan : null;
  const revealTierNow = revealed?.card
    ? revealTier(pickPrice(revealed.card)?.market ?? null)
    : null;
  const burst = revealTierNow === "grail" ? revealed!.id : null;
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!revealed || announced.current === revealed.id) return;
    announced.current = revealed.id;
    if (!revealed.card) fxMiss();
    else fxMatch(revealTierNow ?? "plain");
  }, [revealed, revealTierNow]);

  // Same modal manners as CardDetailModal: Escape closes, the page behind
  // doesn't scroll, and focus goes back to whatever opened the scanner.
  // onClose is an inline arrow on the page, so it goes through a ref — the
  // effect must run once per open, not once per parent render.
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, []);

  const statusDot = error
    ? "bg-amber-400"
    : !ready
      ? "bg-zinc-600"
      : identifying
        ? "bg-brand-400 animate-pulse"
        : "bg-brand-400";
  const statusText = error
    ? "Camera unavailable"
    : !ready
      ? "Opening the camera…"
      : identifying
        ? "Reading the last card — line up the next one"
        : "Fill the guide, then tap Capture";

  return (
    <div
      onPointerDown={() => void primeScanFx()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm sm:p-4"
    >
      {/* .scanner-hud: the scanner's motion is exempt from the reduced-motion
          kill in globals.css — see the motion policy. Full-bleed on phones
          (the viewfinder is the screen, every zone gets its own row so
          nothing sits on the guide); a card in a backdrop from sm up. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Camera scanner"
        tabIndex={-1}
        className="scanner-hud flex h-full w-full flex-col bg-surface-1 pt-[env(safe-area-inset-top)] outline-none sm:h-auto sm:max-w-lg sm:gap-3 sm:rounded-3xl sm:border sm:border-edge sm:p-4"
      >
        {/* Status row: what the scanner is doing (left) and the running score
            for the session (right). Fixed height so the viewfinder never
            jumps as the text changes. */}
        <div className="flex h-11 shrink-0 items-center gap-3 px-4 text-[11px] sm:h-auto sm:px-1">
          <div className="flex min-w-0 flex-1 items-center gap-2 font-medium">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot}`} />
            <span className="truncate text-zinc-200">{statusText}</span>
          </div>
          {tally && tally.count > 0 && (
            <div className="flex shrink-0 items-baseline gap-1.5">
              <span className="font-display text-sm font-semibold text-white">{tally.count}</span>
              <span className="text-zinc-400">{tally.count === 1 ? "card" : "cards"}</span>
              {tally.value > 0 && (
                <>
                  <span className="text-zinc-600">·</span>
                  <span className="font-display text-sm font-semibold text-holo-gold">
                    {formatMoney(tally.value)}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden bg-black sm:flex-none sm:rounded-2xl">
          {/* playsInline keeps iOS from hijacking the stream into a
              fullscreen player, which would hide the capture button. */}
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-contain sm:h-auto sm:max-h-[60dvh] sm:min-h-64"
          />

          {/* Card-shaped framing guide: real cards are 63×88mm, and a guide
              at that ratio nudges the photo toward filling the frame, which
              is most of what separates a good scan from a bad one. Placed by
              guideGeometry so it clears the button column. The huge
              box-shadow dims everything outside the guide. */}
          {ready && guide && (
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              aria-hidden
            >
              {burst && <span key={burst} className="reveal-burst" aria-hidden />}
              <div
                className="absolute rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                style={{ left: guide.x, top: guide.y, width: guide.w, height: guide.h }}
              >
                {/* The laser sweep (reference: Scrydex Vision) — runs while
                    the scanner is looking or reading, rests once the card
                    is captured and matched. Clipped to the guide. */}
                {sweeping && (
                  <span className="absolute inset-0 overflow-hidden rounded-xl" aria-hidden>
                    <span className="scan-sweep" />
                  </span>
                )}
                <span className={`absolute -left-px -top-px h-8 w-8 rounded-tl-xl border-l-3 border-t-3 transition-colors ${bracket}`} />
                <span className={`absolute -right-px -top-px h-8 w-8 rounded-tr-xl border-r-3 border-t-3 transition-colors ${bracket}`} />
                <span className={`absolute -bottom-px -left-px h-8 w-8 rounded-bl-xl border-b-3 border-l-3 transition-colors ${bracket}`} />
                <span className={`absolute -bottom-px -right-px h-8 w-8 rounded-br-xl border-b-3 border-r-3 transition-colors ${bracket}`} />
                {/* The strike, then the stamp + ring: the instant the match
                    lands. Keyed by scan id so every card gets its own. */}
                {revealed?.card && (
                  <RevealStrike key={`strike-${revealed.id}`} tier={revealTierNow ?? "plain"} />
                )}
                {revealed && (
                  <RevealStamp key={revealed.id} matched={Boolean(revealed.card)} tier={revealTierNow ?? "plain"} />
                )}
              </div>
            </div>
          )}

          {/* The one column that stays on the video: close, torch, sound —
              a phone user reaches for the corner. The guide is narrowed to
              clear it (GUIDE_GUTTER_PX). */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close scanner"
            className="absolute right-3 top-3 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/60 text-lg leading-none text-white backdrop-blur transition hover:border-white/40 hover:bg-black/80"
          >
            ✕
          </button>

          {torch !== "unavailable" && (
            <button
              onClick={toggleTorch}
              aria-pressed={torch === "on"}
              aria-label="Camera light"
              className={`absolute right-3 top-16 z-20 flex h-11 w-11 items-center justify-center rounded-full border text-lg backdrop-blur transition ${
                torch === "on"
                  ? "border-amber-300/60 bg-amber-400/90 shadow-lg shadow-amber-400/40"
                  : "border-white/20 bg-black/60 hover:border-white/40"
              }`}
            >
              {torch === "on" ? "🔆" : "🔦"}
            </button>
          )}

          {/* Sound + haptics toggle, remembered. Sits under the torch. */}
          {ready && (
            <button
              type="button"
              onClick={() => {
                const next = !fxOn;
                setFxOn(next);
                setScanFxEnabled(next);
              }}
              aria-pressed={fxOn}
              aria-label={fxOn ? "Scan sounds on" : "Scan sounds off"}
              className={`absolute right-3 z-20 flex h-11 w-11 items-center justify-center rounded-full border text-base backdrop-blur transition ${
                torch !== "unavailable" ? "top-[7.25rem]" : "top-16"
              } ${fxOn ? "border-white/20 bg-black/60" : "border-white/10 bg-black/40 text-zinc-500"}`}
            >
              {fxOn ? "🔊" : "🔇"}
            </button>
          )}

          {flash && (
            <div className="absolute inset-0 bg-white/70" aria-hidden />
          )}
          {!ready && !error && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
              Starting camera…
            </p>
          )}
          {error && (
            <div className="flex min-h-40 flex-col items-center justify-center gap-4 p-6 text-center">
              <p className="max-w-sm text-sm text-zinc-300">{error}</p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  onClick={() => fallbackInputRef.current?.click()}
                  className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400"
                >
                  Choose photos instead
                </button>
                <button
                  onClick={() => {
                    setError(null);
                    setRetryKey((k) => k + 1);
                  }}
                  className="rounded-full border border-edge bg-surface-2 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-edge-strong"
                >
                  Try the camera again
                </button>
              </div>
              <input
                ref={fallbackInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (files.length === 0) return;
                  for (const file of files) onCapture(file);
                  onClose();
                }}
              />
            </div>
          )}
        </div>

        {/* The result chip lives under the viewfinder, not over the guide —
            on a phone the guide is most of the frame and a chip on it hid
            the card. Until the first scan the slot carries the how-to. */}
        <div className="flex min-h-24 shrink-0 items-center px-3 py-1 sm:px-0 sm:py-0">
          {lastScan ? (
            <ScanToast key={lastScan.id} item={lastScan} />
          ) : (
            <p className="w-full text-center text-xs text-zinc-500">
              Fill the guide with one card, then tap Capture. Keep going for a whole
              stack — each shot is scanned while you line up the next.
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:justify-center sm:gap-3 sm:px-0 sm:pb-0">
          <button
            onClick={capture}
            disabled={!ready}
            className="flex-1 whitespace-nowrap rounded-full bg-brand-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
          >
            Capture card
          </button>
          <button
            onClick={onClose}
            className="shrink-0 whitespace-nowrap rounded-full border border-edge bg-surface-2 px-5 py-3 text-sm font-medium text-zinc-200 transition hover:border-edge-strong"
          >
            {captured > 0 ? `Done · ${captured}` : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The live result strip under the viewfinder for the most recent capture — a
 * glass chip that fades up in its own row (never over the guide): icon,
 * MATCH FOUND, name, and confidence when vision reports one.
 */
function ScanToast({ item }: { item: ScanItem }) {
  const scanning = item.status === "queued" || item.status === "scanning";

  if (scanning) {
    return (
      <div className="animate-fade-up flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-black/75 px-4 py-3 backdrop-blur-md">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/20">
          <span className="h-2 w-2 animate-pulse rounded-full bg-brand-300" />
        </span>
        <div>
          <p className="text-[10px] font-semibold tracking-[0.2em] text-brand-300">
            IDENTIFYING
          </p>
          <p className="text-sm font-medium text-zinc-200">Reading the card…</p>
        </div>
      </div>
    );
  }

  if (!item.card) {
    return (
      <div className="animate-fade-up flex w-full items-center gap-3 rounded-2xl border border-amber-400/30 bg-black/75 px-4 py-3 backdrop-blur-md">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">
          ?
        </span>
        <p className="text-sm font-medium text-amber-300">
          No match — line the card up in the guide and try again
        </p>
      </div>
    );
  }

  return <RevealChip item={item} />;
}

/**
 * Count from 0 to `value` once, eased, ~0.8s. The number arriving is the
 * beat of the reveal — a static figure reads as "already knew that".
 */
function useCountUp(value: number | null, ms = 800): number | null {
  // Progress 0→1; the displayed number is derived, so a null value needs
  // no state write and the effect only ever schedules frames.
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (value == null) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setProgress(1 - Math.pow(1 - k, 3));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return value == null ? null : value * progress;
}

const TIER_STYLE: Record<
  RevealTier,
  { border: string; label: string; labelText: string; price: string }
> = {
  plain: {
    border: "border-emerald-400/30",
    label: "text-emerald-400",
    labelText: "MATCH FOUND",
    price: "text-white",
  },
  nice: {
    border: "border-emerald-400/40",
    label: "text-emerald-400",
    labelText: "MATCH FOUND",
    price: "text-white",
  },
  big: {
    border: "border-holo-gold/50",
    label: "text-holo-gold",
    labelText: "NICE PULL",
    price: "holo-text",
  },
  grail: {
    border: "border-holo-pink/60",
    label: "holo-text",
    labelText: "BIG ONE",
    price: "holo-text",
  },
};

/**
 * The reveal: the matched card's art pops up out of the chip, its name and
 * set land beside it, and the market price counts up on the right — bigger
 * cards get a bigger moment (gold border + foil price at $100, the works at
 * $500). The price is the real market figure (pickPrice) or nothing;
 * confidence shows only when vision reported one.
 */
function RevealChip({ item }: { item: ScanItem }) {
  const card = item.card!;
  const price = pickPrice(card);
  const market = price?.market ?? null;
  const tier = revealTier(market);
  const style = TIER_STYLE[tier];
  const counted = useCountUp(market);
  const confidence = item.vision?.confidence;

  return (
    <div
      className={`animate-fade-up flex w-full items-center gap-3 rounded-2xl border bg-black/80 px-3 py-2.5 backdrop-blur-md ${style.border}`}
    >
      <div className="reveal-art relative h-16 w-[46px] shrink-0 overflow-hidden rounded-md shadow-lg shadow-black/60 ring-1 ring-white/15">
        {card.imageSmall ? (
          <CardImage src={card.imageSmall} alt="" className="h-full w-full" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-holo-violet/40 to-holo-pink/40 text-white">
            ✓
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-[10px] font-semibold tracking-[0.2em] ${style.label}`}>
          {style.labelText}
          {typeof confidence === "number" && (
            <span className="ml-2 font-normal tracking-normal text-zinc-500">
              {(confidence * 100).toFixed(0)}% sure
            </span>
          )}
        </p>
        <p className="truncate font-display text-base font-semibold leading-tight text-white">
          {card.name}
        </p>
        <p className="truncate text-xs text-zinc-400">
          {card.setName}
          {card.number ? ` · #${card.number}` : ""}
        </p>
      </div>
      <div className="reveal-price shrink-0 text-right">
        {counted != null ? (
          <>
            <p className={`font-display text-xl font-semibold leading-none tabular-nums ${style.price}`}>
              {counted >= 10
                ? formatMoney(Math.round(counted), price?.currency).replace(/.00$/, "")
                : formatMoney(counted, price?.currency)}
            </p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.15em] text-zinc-500">market</p>
          </>
        ) : (
          <p className="text-[10px] uppercase tracking-[0.15em] text-zinc-500">no price yet</p>
        )}
      </div>
    </div>
  );
}

const STAMP: Record<RevealTier, { text: string; className: string; ring: string }> = {
  plain: { text: "Found!", className: "text-white", ring: "text-emerald-400" },
  nice: { text: "Found!", className: "text-emerald-300", ring: "text-emerald-400" },
  big: { text: "Nice pull!", className: "holo-text", ring: "text-holo-gold" },
  grail: { text: "Big one!", className: "holo-text", ring: "text-holo-pink" },
};

/**
 * "Found!" slams into the middle of the guide the instant the scan resolves,
 * with a ring kicking outward from the brackets, then clears in ~1.4s so the
 * chip below carries the detail. The one place CardFlip raises its voice
 * (Chris's call, 08-16) — the copy is tiered with the reveal. A miss gets a
 * quiet, un-tilted "No match" instead.
 */
/** Glow colour of the strike, by tier — same ladder as the stamp. */
const STRIKE_GLOW: Record<RevealTier, string> = {
  plain: "var(--color-holo-violet)",
  nice: "#34d399",
  big: "var(--color-holo-gold)",
  grail: "var(--color-holo-pink)",
};

/**
 * Lightning strike: a white-hot bolt drawn from the top edge of the guide
 * to its centre in ~120ms, two flickers, then it fades — with a full-guide
 * flash under it. Lands a beat before the stamp slams. Grail adds a second
 * bolt from the other corner. Pure CSS (globals.css .reveal-strike /
 * .reveal-flash), one-shot, keyed per scan by the caller.
 */
function RevealStrike({ tier }: { tier: RevealTier }) {
  const style = { "--strike-glow": STRIKE_GLOW[tier] } as React.CSSProperties;
  return (
    <>
      <span className="reveal-flash" style={style} aria-hidden />
      <svg
        className="reveal-strike"
        viewBox="0 0 100 140"
        preserveAspectRatio="none"
        style={style}
        aria-hidden
      >
        <path d="M60 0 L48 30 L58 36 L46 62 L54 60 L50 72" />
        <path className="branch" d="M48 30 L37 46 L41 45" />
        {tier === "grail" && <path className="second" d="M16 0 L30 24 L22 30 L42 58 L50 72" />}
      </svg>
    </>
  );
}

function RevealStamp({ matched, tier }: { matched: boolean; tier: RevealTier }) {
  if (!matched) {
    return (
      <span
        className="reveal-stamp-flat absolute inset-0 flex items-center justify-center font-display text-2xl font-semibold text-amber-300"
        aria-hidden
      >
        No match
      </span>
    );
  }
  const stamp = STAMP[tier];
  return (
    <>
      <span className={`reveal-ring ${stamp.ring}`} aria-hidden />
      <span
        className={`reveal-stamp absolute inset-0 flex items-center justify-center font-display text-5xl font-bold tracking-tight ${stamp.className}`}
        aria-hidden
      >
        {stamp.text}
      </span>
    </>
  );
}

