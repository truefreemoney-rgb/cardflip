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

/** What the auto-scanner believes about the frame right now. */
type Phase = "idle" | "settling" | "captured";

// ---------------------------------------------------------------------------
// Auto-scan tuning. Luminance is 0–255; signatures are 24×32 grayscale
// thumbnails of the guide region, sampled every SAMPLE_MS.
const SAMPLE_MS = 200;
/** Below this mean frame-to-frame difference the card is "not moving". */
const STEADY_MOTION = 6;
/** Holos shimmer: their luminance flickers above STEADY_MOTION while held
    perfectly still (09-01, Chris's phone — auto never fired on holos). Up to
    here still counts as steady, it just needs a longer hold; a real swap
    spikes past MOVING_MOTION regardless. */
const SHIMMER_MOTION = 11;
/** Close-up handheld: tremor is amplified in pixels the nearer the card, so
    a phone held close never gets under SHIMMER_MOTION (09-01, Chris — "auto
    is unusable unless you hold the camera far away"). Wobble below the swap
    threshold still counts, it just takes a long deliberate hold. */
const WOBBLE_MOTION = MOVING_MOTION;
/** Steady points before a capture: crisp-still frames score 4, shimmering
    ones 2, close-up wobble 1 — matte at arm's length fires in 3 samples
    (0.6s), holos in 6 (1.2s), a wobbly close-up in 12 (2.4s). */
const STEADY_POINTS = 12;
/** Above this the frame is "moving" — a swap in progress. */
const MOVING_MOTION = 15;
/** Std-dev floor: an empty mat/table is flat; a card has print on it. */
const CONTENT_STDDEV = 28;
/** Difference from the last captured signature that counts as a new card. */
const NEW_CARD_DIFF = 25;
const SIG_W = 24;
const SIG_H = 32;

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
 * Auto-scan (on by default) removes the shutter from that loop: a small
 * grayscale thumbnail of the guide region is sampled a few times a second,
 * and when the frame holds still, has something printed in it, and looks
 * different from the last card captured, it captures by itself. Swapping the
 * card is what re-arms it (the swap is motion; the new card is a new
 * signature), so one placement = one identification — vision cost is the
 * same as a manual shot, there's just no button between the seller and it.
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
  const [auto, setAuto] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  // Lazy initialiser: read the stored preference once, on the client (the
  // modal only ever mounts client-side, after a tap).
  const [fxOn, setFxOn] = useState(() => scanFxEnabled());
  // "unavailable" hides the button entirely — torches only exist on phone
  // back cameras, and a control that can't work is worse than none.
  const [torch, setTorch] = useState<"unavailable" | "off" | "on">(
    "unavailable",
  );

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

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);

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

  // -------------------------------------------------------------------------
  // Auto-scan loop

  const captureRef = useRef(capture);
  useEffect(() => {
    captureRef.current = capture;
  }, [capture]);

  useEffect(() => {
    if (!auto || !ready) return;
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    canvas.width = SIG_W;
    canvas.height = SIG_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let prev: Uint8ClampedArray | null = null;
    let lastCaptured: Uint8ClampedArray | null = null;
    let steady = 0;
    // A swap has to happen between captures — the same card wobbling a bit
    // must not re-fire, but a new card (motion, then a different signature)
    // must.
    let movedSinceCapture = true;
    let lastPhase: Phase = "idle";
    const show = (p: Phase) => {
      if (p !== lastPhase) {
        lastPhase = p;
        setPhase(p);
      }
    };

    const timer = window.setInterval(() => {
      if (video.videoWidth === 0 || video.paused) return;
      // Guide region in video pixels: the guide is 82% of the displayed
      // height at 63:88 and centered; object-contain keeps that mapping.
      const vh = video.videoHeight;
      const vw = video.videoWidth;
      const gh = vh * 0.82;
      const gw = Math.min(vw, gh * (63 / 88));
      const gx = (vw - gw) / 2;
      const gy = (vh - gh) / 2;
      ctx.drawImage(video, gx, gy, gw, gh, 0, 0, SIG_W, SIG_H);
      const { data } = ctx.getImageData(0, 0, SIG_W, SIG_H);
      const n = SIG_W * SIG_H;
      const sig = new Uint8ClampedArray(n);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const l = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
        sig[i] = l;
        sum += l;
      }
      const mean = sum / n;
      let varSum = 0;
      for (let i = 0; i < n; i++) varSum += (sig[i] - mean) ** 2;
      const stddev = Math.sqrt(varSum / n);
      const motion = prev ? meanAbsDiff(sig, prev) : 255;
      prev = sig;

      if (motion > MOVING_MOTION) movedSinceCapture = true;

      const hasContent = stddev > CONTENT_STDDEV;
      const isNew = !lastCaptured || meanAbsDiff(sig, lastCaptured) > NEW_CARD_DIFF;
      const armed = hasContent && isNew && movedSinceCapture;

      if (!armed) {
        steady = 0;
        show(lastCaptured && !isNew ? "captured" : "idle");
        return;
      }
      if (motion < WOBBLE_MOTION) {
        steady += motion < STEADY_MOTION ? 4 : motion < SHIMMER_MOTION ? 2 : 1;
        show("settling");
        if (steady >= STEADY_POINTS) {
          lastCaptured = sig;
          movedSinceCapture = false;
          steady = 0;
          show("captured");
          captureRef.current();
        }
      } else {
        steady = 0;
        show("idle");
      }
    }, SAMPLE_MS);

    return () => window.clearInterval(timer);
  }, [auto, ready]);

  const bracket =
    phase === "captured"
      ? "border-emerald-400"
      : phase === "settling"
        ? "border-holo-pink"
        : "border-brand-400";
  // Sweep while there's something to look for or read: idle (looking),
  // settling (about to fire), or the last capture still identifying. Off
  // once captured-and-swap or a match is showing, so the chip gets the eye.
  const identifying =
    lastScan?.status === "queued" || lastScan?.status === "scanning";
  const sweeping = ready && (identifying || (auto && phase !== "captured"));

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

  return (
    <div
      onPointerDown={() => void primeScanFx()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Camera scanner"
        tabIndex={-1}
        className="flex w-full max-w-lg flex-col gap-4 rounded-3xl border border-edge bg-surface-1 p-4 outline-none"
      >
        {/* .scanner-hud: this overlay's motion is exempt from the
            reduced-motion kill in globals.css — see the motion policy. */}
        <div className="scanner-hud relative overflow-hidden rounded-2xl bg-black">
          {/* playsInline keeps iOS from hijacking the stream into a
              fullscreen player, which would hide the capture button. */}
          <video
            ref={videoRef}
            playsInline
            muted
            className="max-h-[60dvh] min-h-64 w-full object-contain"
          />

          {/* Card-shaped framing guide: real cards are 63×88mm, and a guide
              at that ratio nudges the photo toward filling the frame, which
              is most of what separates a good scan from a bad one. The huge
              box-shadow dims everything outside the guide. Bracket colour is
              the auto-scan state: brand = looking, pink = hold still,
              green = captured. */}
          {ready && (
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              aria-hidden
            >
              {burst && <span key={burst} className="reveal-burst" aria-hidden />}
              <div className="relative aspect-[63/88] h-[82%] rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
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
                {phase === "settling" && (
                  <span className="absolute inset-0 rounded-xl border border-holo-pink/60 animate-pulse-ring" />
                )}
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

          {/* Top-left status pill: what auto-scan is doing right now. */}
          {/* Running score for the session: cards in the queue and what
              they're worth so far. Turns a stack into progress. */}
          {ready && tally && tally.count > 0 && (
            <div className="absolute left-3 top-12 z-10 flex items-baseline gap-1.5 rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-[11px] backdrop-blur">
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
              className={`absolute right-3 flex h-9 w-9 items-center justify-center rounded-full border text-sm backdrop-blur transition ${
                torch !== "unavailable" ? "top-[7.5rem]" : "top-16"
              } ${fxOn ? "border-white/20 bg-black/60" : "border-white/10 bg-black/40 text-zinc-500"}`}
            >
              {fxOn ? "🔊" : "🔇"}
            </button>
          )}

          {/* Close — always reachable, top-right of the viewfinder, above the
              torch and sound toggles. Same as "Done"/"Cancel" below; a phone
              user reaches for the corner. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close scanner"
            className="absolute right-3 top-3 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/60 text-lg leading-none text-white backdrop-blur transition hover:border-white/40 hover:bg-black/80"
          >
            ✕
          </button>

          {ready && auto && (
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-[11px] font-medium backdrop-blur">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  phase === "settling"
                    ? "bg-holo-pink animate-pulse"
                    : phase === "captured"
                      ? "bg-emerald-400"
                      : "bg-brand-400"
                }`}
              />
              <span className="text-zinc-200">
                {phase === "settling"
                  ? "Hold still…"
                  : phase === "captured"
                    ? "Captured — swap the card"
                    : "Auto-scan on"}
              </span>
            </div>
          )}

          {torch !== "unavailable" && (
            <button
              onClick={toggleTorch}
              aria-pressed={torch === "on"}
              aria-label="Camera light"
              className={`absolute right-3 top-16 flex h-11 w-11 items-center justify-center rounded-full border text-lg backdrop-blur transition ${
                torch === "on"
                  ? "border-amber-300/60 bg-amber-400/90 shadow-lg shadow-amber-400/40"
                  : "border-white/20 bg-black/60 hover:border-white/40"
              }`}
            >
              {torch === "on" ? "🔆" : "🔦"}
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

          {lastScan && <ScanToast key={lastScan.id} item={lastScan} />}
        </div>

        <p className="text-center text-xs text-zinc-500">
          {auto
            ? "Hold a card in the guide — it captures itself. Swap cards to keep going; each one is identified while you line up the next."
            : "Fill the guide with one card, then capture. Keep going for a whole stack — each shot is scanned while you line up the next."}
        </p>

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => {
              setAuto((a) => !a);
              setPhase("idle");
            }}
            aria-pressed={auto}
            className={`rounded-full border px-4 py-3 text-xs font-semibold transition ${
              auto
                ? "border-brand-400/50 bg-brand-500/15 text-brand-200"
                : "border-edge bg-surface-2 text-zinc-400 hover:border-edge-strong"
            }`}
          >
            Auto {auto ? "on" : "off"}
          </button>
          <button
            onClick={capture}
            disabled={!ready}
            className="rounded-full bg-brand-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Capture card
          </button>
          <button
            onClick={onClose}
            className="rounded-full border border-edge bg-surface-2 px-5 py-3 text-sm font-medium text-zinc-200 transition hover:border-edge-strong"
          >
            {captured > 0 ? `Done (${captured} scanned)` : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

function meanAbsDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/**
 * The live result strip over the viewfinder for the most recent capture — a
 * glass chip that slides up over the bottom of the frame: icon, MATCH FOUND,
 * name, and confidence when vision reports one.
 */
function ScanToast({ item }: { item: ScanItem }) {
  const scanning = item.status === "queued" || item.status === "scanning";

  if (scanning) {
    return (
      <div className="animate-fade-up absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/75 px-4 py-3 backdrop-blur-md">
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
      <div className="animate-fade-up absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-2xl border border-amber-400/30 bg-black/75 px-4 py-3 backdrop-blur-md">
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
      className={`animate-fade-up absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-2xl border bg-black/80 px-3 py-2.5 backdrop-blur-md ${style.border}`}
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

