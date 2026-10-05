"use client";

import GameToggle from "@/components/GameToggle";
import { GAMES } from "@/lib/games";
import type { GameId } from "@/lib/types";
import { useBodyScrollLock } from "@/lib/client/useBodyScrollLock";
import { useBackToClose } from "@/lib/client/useBackToClose";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/client/useFocusTrap";
import { inAppBrowserName, inAppCameraMessage, isIosWebView } from "@/lib/client/inAppBrowser";
import CardImage from "@/components/CardImage";
import { effectiveVariant, formatMoney, headlinePrice, marketFlagOf } from "@/lib/listing";
import { fxCapture, fxMatch, fxMiss, revealTier, type RevealTier } from "@/lib/client/scanFx";
import type { ScanItem } from "@/lib/types";
import {
  SHARPNESS_BAND,
  SHARPNESS_SAMPLE_WIDTH,
  isSharpEnough,
  laplacianVariance,
  rgbaToGray,
} from "@/lib/sharpness";
import {
  CARD_ASPECT,
  HINT_TEXT,
  findCardQuad,
  frameLight,
  growQuad,
  pickHint,
  shouldStraighten,
  toGray,
  warpQuad,
  type Hint,
} from "@/lib/photoQuality";

/** Frames taken per tap; the sharpest one is sent (10-04: a shaky hand loses the collector number first). */
const BURST = 4;

/** The blur score of a guide crop, at the calibration geometry (see lib/sharpness.ts). Infinity when it can't be read. */
function bandSharpness(canvas: HTMLCanvasElement): number {
  const bw = SHARPNESS_SAMPLE_WIDTH;
  const bh = Math.max(3, Math.round((bw * (canvas.height * SHARPNESS_BAND.h)) / (canvas.width * SHARPNESS_BAND.w)));
  const band = document.createElement("canvas");
  band.width = bw;
  band.height = bh;
  const ctx = band.getContext("2d", { willReadFrequently: true });
  if (!ctx) return Infinity;
  ctx.drawImage(
    canvas,
    canvas.width * SHARPNESS_BAND.x,
    canvas.height * SHARPNESS_BAND.y,
    canvas.width * SHARPNESS_BAND.w,
    canvas.height * SHARPNESS_BAND.h,
    0,
    0,
    bw,
    bh,
  );
  try {
    const px = ctx.getImageData(0, 0, bw, bh).data;
    return laplacianVariance(rgbaToGray(px, bw * bh), bw, bh);
  } catch {
    return Infinity;
  }
}

/**
 * A card sitting small or turned in the guide, flattened to fill the photo
 * (lib/photoQuality.ts findCardQuad). Null = send the crop as taken: no card
 * edge found for sure, or it already fills the guide (most shots, 10-04: 1 of
 * 123 prod photos qualified).
 */
/** A photo from the phone's own camera as a canvas no bigger than 2000 px on its long edge (the browser applies the rotation). */
async function photoCanvas(file: File): Promise<HTMLCanvasElement | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d", { willReadFrequently: true })?.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function straighten(crop: HTMLCanvasElement): HTMLCanvasElement | null {
  try {
    const sw = 240;
    const sh = Math.max(40, Math.round((crop.height * sw) / crop.width));
    const small = document.createElement("canvas");
    small.width = sw;
    small.height = sh;
    const sctx = small.getContext("2d", { willReadFrequently: true });
    if (!sctx) return null;
    sctx.drawImage(crop, 0, 0, sw, sh);
    const quad = findCardQuad(toGray(sctx.getImageData(0, 0, sw, sh).data, sw * sh), sw, sh);
    if (!shouldStraighten(quad)) return null;
    const s = crop.width / sw;
    const corners = growQuad(quad.corners.map((p) => ({ x: p.x * s, y: p.y * s })) as typeof quad.corners, 0.015);
    const cctx = crop.getContext("2d", { willReadFrequently: true });
    if (!cctx) return null;
    const full = cctx.getImageData(0, 0, crop.width, crop.height);
    const outH = crop.height;
    const outW = Math.round(outH * CARD_ASPECT);
    const px = warpQuad(full.data, crop.width, crop.height, corners, outW, outH);
    const out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    out.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(px), outW, outH), 0, 0);
    return out;
  } catch {
    return null;
  }
}

interface Props {
  /** Which game the next shot is read as — named on the Capture button (09-29). */
  game?: GameId;
  /** Switch games without leaving the camera. */
  onGameChange?: (game: GameId) => void;
  /**
   * The queue item created by this modal's most recent capture. The scan runs
   * in the page's pump loop, not here — threading the item back in is what
   * lets the viewfinder show "Identifying… → match + confidence" live while
   * the seller lines up the next card.
   */
  lastScan?: ScanItem | null;
  /**
   * The scans waiting to be verified (identified, not yet listed or sold):
   * the count and total on the result chip's button, and the rows of the
   * session sheet behind the tray button (Chris 10-02).
   */
  queue?: ScanItem[];
  /** Remove one scan from the queue (the × on the result chip and in the session sheet). */
  onRemove?: (id: string) => void;
  onCapture: (file: File) => void;
  onClose: () => void;
  /** Tap on the result chip: leave the camera with this card open in the editor. */
  onOpen?: (id: string) => void;
}

export type CaptureMode = "card" | "page";

/**
 * Guide ratio per mode. A card is 63×88; a 9-pocket page is about 8×11 with
 * the pockets, and a wider guide also fits three cards laid side by side.
 */
const GUIDE_RATIO: Record<CaptureMode, number> = { card: 63 / 88, page: 8 / 11 };
/** Share of the displayed video height the guide takes. */
const GUIDE_HEIGHT: Record<CaptureMode, number> = { card: 0.82, page: 0.92 };

/**
 * Room between the guide and the viewfinder's edge. Nothing sits on the
 * video since the 10-02 makeover (close, light and sound moved to the top
 * bar), so this is only breathing room for the brackets.
 */
const GUIDE_GUTTER_PX = 16;

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
 * unless that would run into the viewfinder's edge — then it's narrowed
 * to leave GUIDE_GUTTER_PX each side and the height follows. object-contain
 * letterboxing is accounted for, so a pillarboxed phone stream maps 1:1.
 * Null until the element is laid out and the stream has a size.
 */
function guideGeometry(
  video: HTMLVideoElement,
  mode: CaptureMode = "card",
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
  const ratio = GUIDE_RATIO[mode];
  let gh = dh * GUIDE_HEIGHT[mode];
  let gw = gh * ratio;
  const maxW = Math.min(dw, Math.max(dw * 0.5, ew - 2 * GUIDE_GUTTER_PX));
  if (gw > maxW) {
    gw = maxW;
    gh = gw / ratio;
  }
  const gx = dx + (dw - gw) / 2;
  const gy = dy + (dh - gh) / 2;
  return {
    display: { x: gx, y: gy, w: gw, h: gh },
    video: { x: (gx - dx) / scale, y: (gy - dy) / scale, w: gw / scale, h: gh / scale },
  };
}

/** Guide in video px, falling back to the centered 82% rect if not laid out. */
function guideInVideo(video: HTMLVideoElement, mode: CaptureMode = "card"): GuideRect {
  const g = guideGeometry(video, mode);
  if (g) return g.video;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const h = vh * GUIDE_HEIGHT[mode];
  const w = Math.min(vw, h * GUIDE_RATIO[mode]);
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
export default function CameraCapture({ game, onGameChange, lastScan, queue, onRemove, onCapture, onClose, onOpen }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // One card fills the guide. The Binder Page mode (09-27) went 10-03 with
  // every upload path: one card per shot, from the camera, is the only way in.
  const mode: CaptureMode = "card";
  const [error, setError] = useState<string | null>(null);
  // Bumped by "Try again" to re-run the getUserMedia effect after a denial.
  const [retryKey, setRetryKey] = useState(0);
  // Inside TikTok / Instagram / Facebook (10-05, Chris's iPhone in TikTok): their browser forces live video into its own
  // fullscreen player and the viewfinder froze, so there the scanner opens the phone's own camera instead. The input's
  // capture="environment" opens the camera itself, not the photo library: every photo is still one taken now (10-03 rule).
  // Also switched on the moment the live video gets pulled into a fullscreen player (webkitbeginfullscreen below), so an
  // app browser that names itself nowhere still lands here.
  const [nativeCam, setNativeCam] = useState(() => inAppBrowserName() !== null || isIosWebView());
  const photoInput = useRef<HTMLInputElement>(null);
  // No file-picker escape hatch when the camera won't open (10-03): a photo
  // from the gallery is an upload, and eBay rejects listings that reuse
  // pictures. The message says how to turn the camera back on instead.
  const [ready, setReady] = useState(false);
  const [captured, setCaptured] = useState(0);
  const [flash, setFlash] = useState(false);
  // Blur gate (09-03): a soft frame is refused once with a nudge instead of
  // spending a scan on a guess. The very next tap always goes through —
  // a seller who can't get it sharper (foil glare, low light) must never
  // be stuck behind the gate.
  const [blurNote, setBlurNote] = useState<string | null>(null);
  const lastBlurRejectAt = useRef(0);
  // Lazy initialiser: read the stored preference once, on the client (the
  // modal only ever mounts client-side, after a tap).
  // The session sheet (10-02): every scan waiting to verify, each with a remove ×.
  const [trayOpen, setTrayOpen] = useState(false);
  const waiting = queue ?? [];
  const verify = waiting.length > 0 ? { count: waiting.length, value: waiting.reduce((sum, item) => sum + headlinePrice(item), 0) } : null;
  // The sheet is open only while there is something in it (the last × closes it).
  const sheetOpen = trayOpen && verify !== null;
  // "unavailable" hides the button entirely — torches only exist on phone
  // back cameras, and a control that can't work is worse than none.
  const [torch, setTorch] = useState<"unavailable" | "off" | "on">(
    "unavailable",
  );
  // Where the guide is drawn, in the video element's box. Measured, not
  // CSS-sized, so the sampler and the crop read exactly what's on screen.
  const [guide, setGuide] = useState<GuideRect | null>(null);
  // Live photo hint above the guide (10-04): too dark, glare, hold still, move closer. Advisory, never a gate.
  const [hint, setHint] = useState<Hint | null>(null);
  // A capture (the burst) is running: no second tap, and the hint sampler rests.
  const busy = useRef(false);
  // Android: the camera takes focus points (tap-to-focus); iPhones don't expose focus to web pages.
  const canFocus = useRef(false);
  const [focusRing, setFocusRing] = useState<{ x: number; y: number; key: number } | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !ready) return;
    const measure = () => setGuide(guideGeometry(video, mode)?.display ?? null);
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
  }, [ready, mode]);

  useEffect(() => {
    if (nativeCam) return;
    let cancelled = false;

    (async () => {
      try {
        // "environment" is the phone's back camera; desktops have no facing
        // and fall back to whatever webcam exists. The high ideal size is
        // for the collector number — it's the smallest print on the card,
        // and the vision client downscales to its own budget regardless.
        // Some Android WebViews reject the ideal size + facing combination
        // outright (OverconstrainedError) instead of approximating, so the
        // ask relaxes twice before giving up (mobile QA 09-06).
        const edge = 1920;
        const attempts: MediaStreamConstraints[] = [
          { video: { facingMode: { ideal: "environment" }, width: { ideal: edge }, height: { ideal: edge } } },
          { video: { facingMode: "environment" } },
          { video: true },
        ];
        let stream: MediaStream | null = null;
        for (let i = 0; i < attempts.length; i++) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(attempts[i]);
            break;
          } catch (err) {
            const relaxable = err instanceof DOMException && (err.name === "OverconstrainedError" || err.name === "ConstraintNotSatisfiedError");
            if (!relaxable || i === attempts.length - 1) throw err;
          }
        }
        if (!stream) throw new DOMException("no stream", "NotReadableError");

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          // An app browser that forces inline video fullscreen (TikTok's, 10-05): leave the player, drop the stream and
          // use the phone's own camera instead.
          video.addEventListener(
            "webkitbeginfullscreen",
            () => {
              (video as HTMLVideoElement & { webkitExitFullscreen?: () => void }).webkitExitFullscreen?.();
              stream?.getTracks().forEach((track) => track.stop());
              setNativeCam(true);
            },
            { once: true },
          );
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
        // Keep refocusing as the card moves (Android Chrome); a phone that
        // can't is left on its own default. Best effort, never an error.
        const focusModes = (capabilities as { focusMode?: string[] } | undefined)?.focusMode ?? [];
        if (focusModes.includes("continuous")) {
          canFocus.current = true;
          track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
        }
      } catch (err) {
        // NotAllowedError = the user (or a site setting) blocked the camera —
        // "allow it in the prompt" is wrong advice there, the prompt won't
        // reappear until the site permission is reset.
        const denied = err instanceof DOMException && err.name === "NotAllowedError";
        const missing = err instanceof DOMException && err.name === "NotFoundError";
        // Inside TikTok / Instagram / Facebook the fix is leaving their browser, not a site setting (10-04).
        const inApp = inAppBrowserName();
        setError(
          inApp && !missing
            ? inAppCameraMessage(inApp)
            : denied
            ? "Camera access is blocked for this site. Turn it on in your browser's site settings (the icon by the address bar), then try again. Every listing needs a photo you take here, so there is no photo upload."
            : missing
              ? "No camera found on this device. CardFlip scans from a live camera only, so open cardflip.io on your phone."
              : "Couldn't open the camera. Check that nothing else is using it, then try again.",
        );
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [retryKey, nativeCam]);

  // iOS ends the MediaStream when the PWA is backgrounded or the phone locks;
  // the <video> then sits frozen/black until the sheet is closed and reopened
  // (mobile QA 09-06). Re-acquire when the page is visible again and the
  // track is no longer live.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const track = streamRef.current?.getVideoTracks()[0];
      if (track && track.readyState === "live") return;
      setReady(false);
      setTorch("unavailable");
      setRetryKey((k) => k + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, []);

  // Plain function (10-03): the React Compiler lint refused the useCallback here.
  const toggleTorch = async () => {
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
  };

  // Live hints (10-04): a small, cheap look at the guide a few times a second.
  // A hint shows after two samples agree, so it doesn't flicker. Thresholds
  // come from 123 real prod photos (scripts/calibrate-photo-quality.mjs).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !ready) return;
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    let last: Hint | null = null;
    let streak = 0;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible" || busy.current || video.videoWidth === 0) return;
      const g = guideInVideo(video, mode);
      const w = 120;
      const h = Math.max(40, Math.round((w * g.h) / g.w));
      c.width = w;
      c.height = h;
      ctx.drawImage(video, g.x, g.y, g.w, g.h, 0, 0, w, h);
      let data: Uint8ClampedArray;
      try {
        data = ctx.getImageData(0, 0, w, h).data;
      } catch {
        return;
      }
      const gray = toGray(data, w * h);
      const light = frameLight(data, w, h);
      // The card-size check only when nothing more pressing is wrong.
      // No live "Hold still" (10-04, Chris's phone: a hand-held phone over a binder page never reads as still,
      // so it stuck on). Shake is handled at the tap: the sharpest of the burst, then the blur gate.
      const next = pickHint(light, null, null) ?? pickHint(light, null, findCardQuad(gray, w, h)?.area ?? null);
      if (next === last) streak++;
      else {
        last = next;
        streak = 1;
      }
      if (streak === 2) setHint(next);
    }, 350);
    return () => window.clearInterval(id);
  }, [ready, mode]);

  // Tap the picture to focus there (Android); the ring shows only when the camera took it.
  const tapToFocus = (e: React.PointerEvent<HTMLVideoElement>) => {
    const video = videoRef.current;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!video || !track || !canFocus.current || !video.videoWidth) return;
    const r = video.getBoundingClientRect();
    const scale = Math.min(r.width / video.videoWidth, r.height / video.videoHeight);
    const dx = (r.width - video.videoWidth * scale) / 2;
    const dy = (r.height - video.videoHeight * scale) / 2;
    const nx = (e.clientX - r.left - dx) / (video.videoWidth * scale);
    const ny = (e.clientY - r.top - dy) / (video.videoHeight * scale);
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
    const at = { x: e.clientX - r.left, y: e.clientY - r.top, key: Date.now() };
    track
      .applyConstraints({ advanced: [{ pointsOfInterest: [{ x: nx, y: ny }], focusMode: "single-shot" } as MediaTrackConstraintSet] })
      .then(() => {
        setFocusRing(at);
        setTimeout(() => setFocusRing((f) => (f?.key === at.key ? null : f)), 700);
        // Back to following the card a moment later.
        setTimeout(() => track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {}), 2500);
      })
      .catch(() => {});
  };

  const capture = useCallback(async () => {
    const video = videoRef.current;
    // videoWidth is 0 until the stream delivers its first frame.
    if (!video || video.videoWidth === 0 || busy.current) return;
    busy.current = true;
    try {

    // Crop to the guide, not the whole sensor frame. The viewfinder dims
    // everything outside the card-shaped guide, so the seller frames the card
    // IN the guide — saving the full frame put a small card in a sea of table
    // (Chris, 09-02: "looks like I'm much closer than the photo comes out").
    // Same guide geometry as the viewfinder (guideInVideo), 1:1 — no margin. There was a 5% one so a card nosing
    // past a bracket kept its edge; it read as the photo coming out ~10%
    // farther than what was framed (Chris, 09-03: "make it 10% closer").
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const { x: gx, y: gy, w: gw, h: gh } = guideInVideo(video, mode);
    const pad = 0;
    const sx = Math.max(0, gx - pad);
    const sy = Math.max(0, gy - pad);
    const sw = Math.min(vw - sx, gw + pad * 2);
    const sh = Math.min(vh - sy, gh + pad * 2);

    const grab = () => {
      const c = document.createElement("canvas");
      c.width = Math.round(sw);
      c.height = Math.round(sh);
      c.getContext("2d", { willReadFrequently: true })?.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return c;
    };
    // The next new video frame, or 90 ms, whichever comes first (Safari < 15.4 has no frame callback).
    const nextFrame = () =>
      new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        setTimeout(finish, 90);
        (video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback?.(finish);
      });

    // Burst (10-04): a few frames over about a tenth of a second, the sharpest
    // one wins, scored on the attack-text band at the calibration geometry.
    let canvas = grab();
    let score = bandSharpness(canvas);
    for (let i = 1; i < BURST; i++) {
      await nextFrame();
      const c = grab();
      const s = bandSharpness(c);
      if (s > score) {
        canvas = c;
        score = s;
      }
    }
    const now = Date.now();
    if (!isSharpEnough(score) && now - lastBlurRejectAt.current > 8000) {
      lastBlurRejectAt.current = now;
      setBlurNote("Looks blurry — hold still and tap again");
      setTimeout(() => setBlurNote(null), 2500);
      return;
    }
    // A card small or turned in the guide is flattened to fill the photo.
    const photo = straighten(canvas) ?? canvas;

    photo.toBlob(
      (blob) => {
        if (!blob) {
          // Safari under memory pressure hands back null; the tap did nothing
          // and said nothing (mobile QA 09-06).
          setBlurNote("Couldn't capture that frame — tap again");
          setTimeout(() => setBlurNote(null), 2500);
          return;
        }
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
        onCapture(file);
        setCaptured((count) => count + 1);
        setFlash(true);
        setTimeout(() => setFlash(false), 150);
        fxCapture();
      },
      "image/jpeg",
      0.92,
    );
    } finally {
      busy.current = false;
    }
  }, [onCapture, mode]);

  // The phone's own camera (in-app browsers): the photo is flattened to the card when one is found, then sent like a capture.
  const onNativePhoto = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = e.target.files?.[0];
      e.target.value = "";
      if (!picked) return;
      const canvas = await photoCanvas(picked);
      const photo = canvas ? (straighten(canvas) ?? canvas) : null;
      photo?.toBlob(
        (blob) => {
          if (!blob) return;
          onCapture(new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" }));
          setCaptured((count) => count + 1);
          fxCapture();
        },
        "image/jpeg",
        0.92,
      );
      if (!photo) {
        setBlurNote("Couldn't read that photo — tap again");
        setTimeout(() => setBlurNote(null), 2500);
      }
    },
    [onCapture],
  );

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
    ? revealTier(revealMarket(revealed))
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
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);
  useBodyScrollLock();
  // Android Back closes the scanner, not the app.
  useBackToClose("camera", onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm sm:p-4">
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
        {/* Top bar (10-02 makeover): every control that is not Capture lives
            here, off the video — the one way out (left), Card / Page
            (middle), the light (right; the sound toggle went 10-02, Chris:
            no audio in the scanner). Solid, no blur: iOS. */}
        {/* Widths at 360px with the light showing: 60 + 169 + 40 + gaps = 281 of 336. */}
        <div className="flex h-12 shrink-0 items-center gap-1.5 px-3 sm:h-auto sm:px-0">
          <button
            type="button"
            onClick={onClose}
            aria-label={captured > 0 ? "Done, close scanner" : "Close scanner"}
            className="flex h-10 shrink-0 items-center whitespace-nowrap rounded-full border border-edge bg-surface-2 px-3 text-xs font-semibold text-zinc-200 transition hover:border-edge-strong"
          >
            {captured > 0 ? "Done" : "Close"}
          </button>

          {/* Session tally (10-03, Chris: the gap between Close and the light
              looked bare). Idle = what is being scanned; once a card lands it
              counts the stack and its market total, the same numbers as the
              verify chip, so the top of the screen always says where you are. */}
          <div className="flex min-w-0 flex-1 justify-center">
            <div
              aria-live="polite"
              className="flex h-10 min-w-0 items-center gap-2 rounded-full border border-edge bg-surface-2 px-3.5 text-xs text-zinc-300"
            >
              {verify ? (
                <>
                  <span className="font-semibold tabular-nums text-white">
                    {verify.count} {verify.count === 1 ? "card" : "cards"}
                  </span>
                  {verify.value > 0 && (
                    <>
                      <span className="h-3 w-px bg-edge-strong" aria-hidden />
                      <span className="truncate font-semibold tabular-nums text-emerald-300">
                        {formatMoney(verify.value, "USD")}
                      </span>
                    </>
                  )}
                </>
              ) : (
                <>
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_theme(colors.emerald.400)]" aria-hidden />
                  <span className="truncate">Scanning <span className="font-semibold text-white">{game ? GAMES[game].label : "Cards"}</span></span>
                </>
              )}
            </div>
          </div>

          {torch !== "unavailable" && (
            <button
              type="button"
              onClick={toggleTorch}
              aria-pressed={torch === "on"}
              aria-label="Camera light"
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition ${
                torch === "on"
                  ? "border-amber-300/60 bg-amber-400 text-black"
                  : "border-edge bg-surface-2 text-zinc-200 hover:border-edge-strong"
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden>
                <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
              </svg>
            </button>
          )}
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden bg-black sm:flex-none sm:rounded-2xl">
          {nativeCam ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-6 text-center sm:min-h-64">
              <span className="flex h-[7.5rem] w-[5.4rem] items-center justify-center rounded-xl border-3 border-dashed border-brand-400/70" aria-hidden>
                <svg viewBox="0 0 24 24" className="h-9 w-9 text-brand-300" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
              </span>
              <p className="max-w-xs text-base font-semibold text-white">Tap the button below. Your camera opens.</p>
              <p className="max-w-xs text-sm text-zinc-400">Take a photo of one card, close up so it fills the picture, then tap Use Photo.</p>
              <input ref={photoInput} type="file" accept="image/*" capture="environment" onChange={(e) => void onNativePhoto(e)} className="hidden" />
            </div>
          ) : (
            // playsInline keeps iOS from hijacking the stream into a fullscreen player, which would hide the capture button.
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onPointerDown={tapToFocus}
              className="h-full w-full object-contain sm:h-auto sm:max-h-[60dvh] sm:min-h-64"
            />
          )}
          {focusRing && (
            <span
              key={focusRing.key}
              aria-hidden
              className="pointer-events-none absolute h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/90"
              style={{ left: focusRing.x, top: focusRing.y }}
            />
          )}
          {/* The live hint sits in the dimmed band above the guide, never on the card. */}
          {ready && guide && hint && !blurNote && !nativeCam && (
            <p
              role="status"
              className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-amber-400/40 bg-black/80 px-3 py-1 text-xs font-semibold text-amber-200"
              style={{ top: guide.y >= 32 ? guide.y / 2 : guide.y + 18 }}
            >
              {HINT_TEXT[hint]}
            </p>
          )}

          {/* Card-shaped framing guide: real cards are 63×88mm, and a guide
              at that ratio nudges the photo toward filling the frame, which
              is most of what separates a good scan from a bad one. Placed by
              guideGeometry so it clears the button column. The huge
              box-shadow dims everything outside the guide. */}
          {ready && guide && !nativeCam && (
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
                {mode === "card" && revealed?.card && (
                  <RevealStrike key={`strike-${revealed.id}`} tier={revealTierNow ?? "plain"} />
                )}
                {mode === "card" && revealed && (
                  <RevealStamp key={revealed.id} matched={Boolean(revealed.card)} tier={revealTierNow ?? "plain"} />
                )}
              </div>
            </div>
          )}

          {flash && (
            <div className="absolute inset-0 bg-white/70" aria-hidden />
          )}
          {!ready && !error && !nativeCam && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
              Starting camera…
            </p>
          )}
          {error && (
            // Over the viewfinder, not under it: as a flow sibling this block
            // landed below the video, behind the sticky capture bar — a phone
            // with the camera blocked showed a black screen and no way out
            // (mobile QA 09-07).
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-surface-1/95 p-6 text-center">
              <p className="max-w-sm text-sm text-zinc-300">{error}</p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  onClick={() => {
                    setError(null);
                    setReady(false);
                    setTorch("unavailable");
                    setRetryKey((k) => k + 1);
                  }}
                  className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400"
                >
                  Try the camera again
                </button>
                <button onClick={onClose} className="rounded-full border border-edge bg-surface-2 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-edge-strong">
                  Close
                </button>
              </div>
            </div>
          )}
        </div>

        {/* The result chip lives under the viewfinder, not over the guide —
            on a phone the guide is most of the frame and a chip on it hid
            the card. Until the first scan the slot carries the how-to. */}
        <div className="flex min-h-[4.25rem] shrink-0 items-center px-3 sm:px-0">
          {blurNote ? (
            <p
              role="status"
              className="animate-fade-up w-full rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-center text-sm font-medium text-amber-200"
            >
              {blurNote}
            </p>
          ) : lastScan ? (
            <ScanToast key={lastScan.id} item={lastScan} onOpen={onOpen} onRemove={onRemove} verify={verify} />
          ) : nativeCam ? null : (
            <p className="w-full text-center text-sm leading-snug text-zinc-400">
              Fill the guide with one card, then tap Capture.
              <span className="block text-xs text-zinc-500">Keep going for a whole stack.</span>
            </p>
          )}
        </div>

        {/* Which game the shot is read as (Chris 09-29: beta testers scanned
            Magic with the switch on Pokémon). The scanner also switches by
            itself when the card is another game; this row says it up front. */}
        {game && onGameChange && (
          <div className="flex shrink-0 justify-center px-3 pb-1.5 sm:px-0 sm:pb-0">
            <GameToggle game={game} onChange={onGameChange} compact />
          </div>
        )}

        {/* Capture is the only big button down here: the one obvious action.
            The running "$1.50 · 1 card" score beside it went 10-02 (Chris:
            annoying); the count and total live on the chip's verify button
            now, and the small tray button here opens the session sheet. */}
        <div className="flex shrink-0 items-center gap-3 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:justify-center sm:px-0 sm:pb-0">
          <button
            onClick={nativeCam ? () => photoInput.current?.click() : capture}
            disabled={!ready && !nativeCam}
            className="flex-1 whitespace-nowrap rounded-full bg-brand-500 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-500/20 transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none sm:px-10"
          >
            {game ? `Capture ${GAMES[game].label} Card` : "Capture Card"}
          </button>
          {verify && (
            <button
              type="button"
              onClick={() => setTrayOpen(true)}
              aria-label={`${verify.count} ${verify.count === 1 ? "scan" : "scans"} waiting to verify, open the list`}
              className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-edge bg-surface-2 text-zinc-200 transition hover:border-edge-strong"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="7" y="3" width="12" height="16" rx="2" />
                <path d="M5 7v12a2 2 0 0 0 2 2h10" />
              </svg>
              <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-emerald-500 px-1.5 text-center text-[11px] font-bold leading-5 text-white tabular-nums">
                {verify.count}
              </span>
            </button>
          )}
        </div>
      </div>
      {sheetOpen && verify && (
        <SessionSheet items={waiting} total={verify.value} onRemove={onRemove} onClose={() => setTrayOpen(false)} onVerifyAll={onClose} />
      )}
    </div>
  );
}

/** "5 Scans Waiting To Verify": the chip button's label; shorter once the numbers get long so the money keeps its room. */
export function verifyLabel(count: number, value: number): string {
  const noun = count === 1 ? "Scan" : "Scans";
  const long = count >= 10 || value >= 1000;
  return `${count} ${noun} ${long ? "To Verify" : "Waiting To Verify"}`;
}

/** Thumbnail, name, set · number, price and a remove × — one scan in the session sheet. */
function SessionRow({ item, onRemove }: { item: ScanItem; onRemove?: (id: string) => void }) {
  const card = item.card;
  const market = headlinePrice(item);
  return (
    <li className="flex items-center gap-3 rounded-xl border border-edge bg-surface-2 p-2">
      <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-black/40">
        {card?.imageSmall && <CardImage src={card.imageSmall} alt="" className="h-full w-full" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{card?.name ?? "Not identified"}</p>
        {card && (
          <p className="truncate text-xs text-zinc-400">
            {card.setName}
            {card.number ? ` · #${card.number}` : ""}
          </p>
        )}
      </div>
      <p className="shrink-0 font-display text-sm font-semibold tabular-nums text-emerald-300">{market > 0 ? formatMoney(market) : "—"}</p>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          aria-label={`Remove ${card?.name ?? "this scan"}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white"
        >
          ×
        </button>
      )}
    </li>
  );
}

/**
 * The session sheet (Chris 10-02): every scan waiting to verify, with a × on
 * each, and Verify All at the bottom, which leaves the camera for the queue.
 * Stacks over the scanner (z-60), closes on the backdrop or Escape.
 */
function SessionSheet({
  items,
  total,
  onRemove,
  onClose,
  onVerifyAll,
}: {
  items: ScanItem[];
  total: number;
  onRemove?: (id: string) => void;
  onClose: () => void;
  onVerifyAll: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/90 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Scans waiting to verify"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="panel-solid animate-fade-up flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-2xl border p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/60 outline-none sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-lg font-semibold text-white">Scans waiting to verify</p>
            <p className="mt-0.5 text-sm text-zinc-400 tabular-nums">
              {items.length} {items.length === 1 ? "scan" : "scans"}
              {total > 0 ? ` · ${formatMoney(total)}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white">
            ×
          </button>
        </div>
        <ul className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {items.map((item) => (
            <SessionRow key={item.id} item={item} onRemove={onRemove} />
          ))}
        </ul>
        <button
          type="button"
          onClick={onVerifyAll}
          className="mt-4 w-full shrink-0 rounded-full bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400"
        >
          Verify All
        </button>
      </div>
    </div>
  );
}

/**
 * The live result strip under the viewfinder for the most recent capture — a
 * glass chip that fades up in its own row (never over the guide): icon,
 * MATCH FOUND, name, and confidence when vision reports one.
 */
interface ToastProps {
  item: ScanItem;
  onOpen?: (id: string) => void;
  onRemove?: (id: string) => void;
  /** The chip button's numbers: scans waiting and their market total. */
  verify: { count: number; value: number } | null;
}

function ScanToast({ item, onOpen, onRemove, verify }: ToastProps) {
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
          {/* The scanner says WHY when it knows (token, unreadable read);
              the generic line is for a real miss (09-03). */}
          {item.error ?? "No match — line the card up in the guide and try again"}
        </p>
      </div>
    );
  }

  return <RevealChip item={item} onOpen={onOpen} onRemove={onRemove} verify={verify} />;
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
/**
 * The figure the chip shows: the Market price (headlinePrice) — the same
 * number as the queue row and the header tally. History: 09-03 the chip said
 * $1.03 (market) while the tally said $1.79 (listing price) and Chris wanted
 * one number, so everything moved to the listing price; 10-02 he moved every
 * screen to the Market price instead, with the listing price shown beside it
 * as the eBay Suggested Price. Still one number, everywhere.
 */
function revealMarket(item: ScanItem): number | null {
  if (!item.card) return null;
  const price = headlinePrice(item);
  return price > 0 ? price : null;
}

function RevealChip({ item, onOpen, onRemove, verify }: ToastProps) {
  const card = item.card!;
  // Hold the number until the chart point is fetched (undefined = not yet):
  // it can move the market to today's figure, and the number is revealed
  // once, never corrected a beat later. eBay comps no longer feed this number
  // (10-02), so the chip does not wait on them.
  const settled = item.currentPoint !== undefined;
  const market = settled ? revealMarket(item) : null;
  // The price guard: a market the rule does not believe is never the reveal number (no count-up, no tier flourish).
  const flagged = settled && market == null && marketFlagOf(card, effectiveVariant(item), item.currentPoint) != null;
  const tier = revealTier(market);
  // A doubtful match is not a "match found" (Chris's phone 10-01: green MATCH FOUND at 40% sure on the wrong card).
  const style = item.matchDoubt ? { ...TIER_STYLE.plain, border: "border-amber-400/40", label: "text-amber-300", labelText: "CHECK MATCH" } : TIER_STYLE[tier];
  const counted = useCountUp(market);
  const confidence = item.vision?.confidence;

  return (
    <div
      className={`animate-fade-up flex w-full flex-col gap-2 rounded-2xl border bg-black/80 px-3 py-2.5 backdrop-blur-md ${style.border}`}
    >
    <div className="flex w-full items-center gap-3">
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
      {/* Remove this scan on the spot (Chris 10-02): most unwanted scans are the last one. */}
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          aria-label={`Remove ${card.name}`}
          className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-full text-zinc-500 transition hover:bg-white/10 hover:text-white"
        >
          ×
        </button>
      )}
      <div className="reveal-price shrink-0 text-right">
        {counted != null ? (
          <>
            <p className={`font-display text-xl font-semibold leading-none tabular-nums ${style.price}`}>
              {counted >= 10
                ? formatMoney(Math.round(counted), "USD").replace(/.00$/, "")
                : formatMoney(counted, "USD")}
            </p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.15em] text-zinc-500">market price</p>
          </>
        ) : (
          <p className={`text-[10px] uppercase tracking-[0.15em] ${flagged ? "text-amber-300" : "text-zinc-500"} ${settled ? "" : "animate-pulse"}`}>
            {flagged ? "price looks off" : settled ? "no price yet" : "pricing…"}
          </p>
        )}
      </div>
    </div>
      {/* The next step lives on the result (Chris, 09-04): one button, names
          the outcome. Keeps scanning if ignored. 10-02: it counts the scans
          waiting and carries their total ("5 Scans Waiting To Verify · $23.40"),
          the label shortens once the numbers get long, and the words truncate
          before the money ever would. */}
      {onOpen && (
        <button
          type="button"
          onClick={() => onOpen(item.id)}
          className="flex w-full items-center justify-between gap-3 rounded-full bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-400"
        >
          <span className="min-w-0 truncate">{verify ? verifyLabel(verify.count, verify.value) : "Verify Your Scan"}</span>
          {verify && verify.value > 0 && <span className="shrink-0 tabular-nums">{formatMoney(verify.value)}</span>}
        </button>
      )}
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

