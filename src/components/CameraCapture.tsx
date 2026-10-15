"use client";

import GameToggle from "@/components/GameToggle";
import { GAMES } from "@/lib/games";
import type { GameId } from "@/lib/types";
import { useBodyScrollLock } from "@/lib/client/useBodyScrollLock";
import { useBackToClose } from "@/lib/client/useBackToClose";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/client/useFocusTrap";
import { mirrorPossible, startCameraMirror } from "@/lib/client/cameraMirror";
import { inAppBrowserName, isIosWebView } from "@/lib/client/inAppBrowser";
import CardImage from "@/components/CardImage";
import CandidatePicker from "@/components/CandidatePicker";
import CopyEditSheet from "@/components/CopyEditSheet";
import ScannerOptionsSheet from "@/components/ScannerOptionsSheet";
import VerifyAllSheet from "@/components/VerifyAllSheet";
import { effectiveVariant, formatMoney, formatVariantLabel, headlinePrice, marketFlagOf, pickPrice } from "@/lib/listing";
import { fxCapture, fxMatch, fxMiss, revealTier, type RevealTier } from "@/lib/client/scanFx";
import type { Condition, PokemonCard, ScanItem } from "@/lib/types";
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
  findCardQuadNear,
  frameLight,
  growQuad,
  pickHint,
  shouldStraighten,
  toGray,
  warpQuad,
  type Hint,
  type Point,
  type QuadTrace,
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
  /** The out-of-scans message while it applies (the page banner is hidden behind this modal). */
  quotaNote?: string | null;
  onCapture: (file: File) => void;
  onClose: () => void;
  /** Tap on the result chip: leave the camera with this card open in the editor. */
  onOpen?: (id: string) => void;
  /** How the camera came up (10-06, ad funnel): "live", "mirror", "native" (the phone's own camera) or "err-<DOMException name>". */
  onCamera?: (state: string) => void;
  /** "Not this card?": swap the item to a card the seller picked. No new scan is spent. */
  onSwap?: (id: string, card: PokemonCard, candidates: PokemonCard[]) => void;
  /** The result card's details pill: change this copy's condition or printing without leaving the camera (10-15). */
  onEdit?: (id: string, patch: Partial<ScanItem>) => void;
  /** Same condition on every waiting scan, from that sheet; absent when there is only one. */
  onApplyConditionToAll?: (condition: Condition) => void;
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
/** The live picture: the <video>, or the canvas the worker paints in TikTok's iPhone browser (10-05). */
type LiveSource = HTMLVideoElement | HTMLCanvasElement;
const srcW = (el: LiveSource) => (el instanceof HTMLVideoElement ? el.videoWidth : el.width);
const srcH = (el: LiveSource) => (el instanceof HTMLVideoElement ? el.videoHeight : el.height);

function guideGeometry(
  video: LiveSource,
  mode: CaptureMode = "card",
): { display: GuideRect; video: GuideRect } | null {
  const vw = srcW(video);
  const vh = srcH(video);
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
function guideInVideo(video: LiveSource, mode: CaptureMode = "card"): GuideRect {
  const g = guideGeometry(video, mode);
  if (g) return g.video;
  const vw = srcW(video);
  const vh = srcH(video);
  const h = vh * GUIDE_HEIGHT[mode];
  const w = Math.min(vw, h * GUIDE_RATIO[mode]);
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}

const TIPS_KEY = "cf-camera-tips-opens";
const TIPS_MAX_OPENS = 3;

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
export default function CameraCapture({ game, onGameChange, lastScan, queue, onRemove, quotaNote, onCapture, onClose, onOpen, onSwap: onPick, onCamera, onEdit, onApplyConditionToAll }: Props) {
  const onCameraRef = useRef(onCamera);
  useEffect(() => {
    onCameraRef.current = onCamera;
  });
  const [picking, setPicking] = useState(false);
  // The "⋯" sheet in the top bar (10-15): game, starting condition, light, tips, share, help.
  const [options, setOptions] = useState(false);
  // The "This copy" sheet (condition / printing) over the result card.
  const [editing, setEditing] = useState(false);
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
  // 10-05 later: on an iPhone the app browser first gets the MIRROR (cameraMirror.ts: frames painted on a canvas by a
  // worker, no <video> for the app to hijack); only when that fails does it land on the phone camera. Android app
  // browsers try the plain live video first. ?mirror=1 forces the mirror in any browser, for testing.
  const [appBrowser] = useState(() => inAppBrowserName() !== null || isIosWebView());
  const [mirror] = useState(
    () =>
      mirrorPossible() &&
      ((appBrowser && /(iPhone|iPad|iPod)/.test(navigator.userAgent)) || new URLSearchParams(window.location.search).get("mirror") === "1"),
  );
  const [nativeCam, setNativeCam] = useState(() => appBrowser && !mirror && !/Android/.test(navigator.userAgent));
  const mirrorRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (nativeCam) onCameraRef.current?.("native");
  }, [nativeCam]);
  const lastFrameAt = useRef(0);
  const photoInput = useRef<HTMLInputElement>(null);
  // No "open in Safari" anything (10-05, Chris: asking the user to leave the app "looks like our product is shit").
  // TikTok swallowed the x-safari link anyway. The phone camera is the whole fallback.
  // No file-picker escape hatch when the camera won't open (10-03): a photo
  // from the gallery is an upload, and eBay rejects listings that reuse
  // pictures. The message says how to turn the camera back on instead.
  const [ready, setReady] = useState(false);
  // Camera tips (audit G12): shown the first few times the camera opens on this device, until dismissed.
  const [tipsOn, setTipsOn] = useState(() => {
    try {
      return (Number(localStorage.getItem(TIPS_KEY) ?? "0") || 0) < TIPS_MAX_OPENS;
    } catch {
      return false; // storage blocked: skip the tips rather than nag on every open
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(TIPS_KEY, String((Number(localStorage.getItem(TIPS_KEY) ?? "0") || 0) + 1));
    } catch {
      // nothing to remember it with
    }
  }, []);
  // "Tips under the camera" switched back on in the options sheet: the next opens count from zero again.
  function showTips() {
    setTipsOn(true);
    try {
      localStorage.setItem(TIPS_KEY, "0");
    } catch {
      // nothing to remember it with
    }
  }
  function dismissTips() {
    setTipsOn(false);
    try {
      localStorage.setItem(TIPS_KEY, String(TIPS_MAX_OPENS));
    } catch {
      // nothing to remember it with
    }
  }
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
  // Live card outline (10-15, Chris, after TCGplayer's scanner): the four
  // corners the edge finder sees, as fractions of the guide (0..1), smoothed
  // so a hand-held phone draws a steady frame. Null = no card-shaped thing
  // near the guide right now. `ready` = lined up for a clean scan (in the
  // guide, square, lit, no glare): the outline and brackets go green; until
  // then the outline is blue, a "move it here" guide.
  const [outline, setOutline] = useState<{ ready: boolean } | null>(null);
  // The latest fix, the corners drawn right now (gliding toward it), and the polygon they are drawn on.
  const outlineTarget = useRef<[Point, Point, Point, Point] | null>(null);
  const outlineShown = useRef<[Point, Point, Point, Point] | null>(null);
  const outlinePoly = useRef<SVGPolygonElement | null>(null);
  // ?dbg=outline shows what the edge finder sees and why it said no (dev only).
  // Sticky (10-15): the login redirect drops the query, so once seen it stays on in this browser; ?dbg=off clears it.
  const [debugOutline] = useState(() => {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") return false;
    const dbg = new URLSearchParams(window.location.search).get("dbg");
    try {
      if (dbg === "outline") localStorage.setItem("cf:dbg", "outline");
      else if (dbg === "off") localStorage.removeItem("cf:dbg");
      return localStorage.getItem("cf:dbg") === "outline";
    } catch {
      return dbg === "outline";
    }
  });
  const debugCanvas = useRef<HTMLCanvasElement | null>(null);
  const [debugText, setDebugText] = useState("");
  const lastDump = useRef(0);
  const dumped = useRef(0);
  // Every tick's result between two dumps (debug): the twitch lives between frames, not in them.
  const ticks = useRef<unknown[]>([]);
  // A capture (the burst) is running: no second tap, and the hint sampler rests.
  const busy = useRef(false);
  // Android: the camera takes focus points (tap-to-focus); iPhones don't expose focus to web pages.
  const canFocus = useRef(false);
  const [focusRing, setFocusRing] = useState<{ x: number; y: number; key: number } | null>(null);

  useEffect(() => {
    const video = (mirror ? mirrorRef.current : videoRef.current);
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
  }, [ready, mode, mirror]);

  useEffect(() => {
    if (nativeCam) return;
    let cancelled = false;
    let stopMirror: (() => void) | null = null;

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

        if (mirror) {
          const canvas = mirrorRef.current;
          if (!canvas) throw new DOMException("no canvas", "NotReadableError");
          canvas.width = 0;
          canvas.height = 0;
          try {
            const m = await startCameraMirror(stream, canvas, () => (lastFrameAt.current = Date.now()));
            if (cancelled) return m.stop();
            stopMirror = m.stop;
          } catch {
            stream.getTracks().forEach((track) => track.stop());
            if (!cancelled) setNativeCam(true);
            return;
          }
          setReady(true);
          onCameraRef.current?.("mirror");
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
        onCameraRef.current?.("live");

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
        onCameraRef.current?.(`err-${(err instanceof Error ? err.name : "unknown").toLowerCase().replace(/[^a-z]/g, "").slice(0, 30)}`);
        // An app browser whose live camera won't open still has the phone's own camera (10-05).
        if (appBrowser) return setNativeCam(true);
        setError(
          denied
            ? "Camera access is blocked for this site. Turn it on in your browser's site settings (the icon by the address bar), then try again. Every listing needs a photo you take here, so there is no photo upload."
            : missing
              ? "No camera found on this device. CardFlip scans from a live camera only, so open cardflip.io on your phone."
              : "Couldn't open the camera. Check that nothing else is using it, then try again.",
        );
      }
    })();

    return () => {
      cancelled = true;
      stopMirror?.();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [retryKey, nativeCam, mirror, appBrowser]);

  // iOS ends the MediaStream when the PWA is backgrounded or the phone locks;
  // the <video> then sits frozen/black until the sheet is closed and reopened
  // (mobile QA 09-06). Re-acquire when the page is visible again and the
  // track is no longer live.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (mirror) {
        if (Date.now() - lastFrameAt.current < 1500) return;
      } else {
        const track = streamRef.current?.getVideoTracks()[0];
        if (track && track.readyState === "live") return;
      }
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
  }, [mirror]);

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
    const video = (mirror ? mirrorRef.current : videoRef.current);
    if (!video || !ready) return;
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    let last: Hint | null = null;
    let streak = 0;
    // The outline: shown after two sightings in a row, dropped after two
    // misses (one lost frame doesn't blink it).
    let seen: [Point, Point, Point, Point] | null = null;
    let seenStreak = 0;
    let missStreak = 0;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible" || busy.current || srcW(video) === 0) return;
      const g = guideInVideo(video, mode);
      // Look a quarter-guide past the guide on every side (clamped to the
      // frame): a card lined up to fill the guide has its edges ON the guide,
      // and the edge finder walks in from the frame's border, so a guide-only
      // crop never found it (10-04: 1 of 123 real scans). The wider look
      // finds a card that fills the guide, sits small in it, or pokes out.
      const vw = srcW(video);
      const vh = srcH(video);
      const sx = Math.max(0, g.x - g.w * 0.25);
      const sy = Math.max(0, g.y - g.h * 0.25);
      const sw = Math.min(vw, g.x + g.w * 1.25) - sx;
      const sh = Math.min(vh, g.y + g.h * 1.25) - sy;
      // 224 wide (was 160; 10-15 Chris: the line "bleeds into the card"):
      // a pixel here is under half a percent of the card.
      const w = 224;
      const h = Math.max(40, Math.round((w * sh) / sw));
      c.width = w;
      c.height = h;
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
      let data: Uint8ClampedArray;
      try {
        data = ctx.getImageData(0, 0, w, h).data;
      } catch {
        return;
      }
      const gray = toGray(data, w * h);
      const light = frameLight(data, w, h);
      // How much bigger the look is than the guide: the card-size floor and
      // the "move closer" hint are both stated against the guide.
      const grow = (sw / g.w) * (sh / g.h);
      // No live "Hold still" (10-04, Chris's phone: a hand-held phone over a binder page never reads as still,
      // so it stuck on). Shake is handled at the tap: the sharpest of the burst, then the blur gate.
      const trace: QuadTrace | undefined = debugOutline ? { reason: "", T: 0, maxStep: 0, sides: "" } : undefined;
      // The guide, in the crop's pixels: where the card is expected.
      const expect = { x: ((g.x - sx) / sw) * w, y: ((g.y - sy) / sh) * h, w: (g.w / sw) * w, h: (g.h / sh) * h };
      // Last tick's corners back in this crop's pixels, so the pick sticks.
      const prefer = seen
        ? (seen.map((p) => ({ x: ((p.x * g.w + g.x - sx) / sw) * w, y: ((p.y * g.h + g.y - sy) / sh) * h })) as [Point, Point, Point, Point])
        : null;
      const quad = findCardQuadNear(gray, w, h, expect, 0.3 / grow, trace, prefer);
      // The card-size check only when nothing more pressing is wrong.
      const next = pickHint(light, null, null) ?? pickHint(light, null, quad ? quad.area * grow : null);
      if (trace && debugCanvas.current) {
        const dc = debugCanvas.current;
        const dctx = dc.getContext("2d");
        if (dctx) {
          dc.width = w;
          dc.height = h;
          dctx.drawImage(c, 0, 0);
          // The guide, in the crop.
          dctx.strokeStyle = "#a78bfa";
          dctx.lineWidth = 1;
          dctx.strokeRect(((g.x - sx) / sw) * w, ((g.y - sy) / sh) * h, (g.w / sw) * w, (g.h / sh) * h);
          if (quad) {
            dctx.strokeStyle = "#34d399";
            dctx.lineWidth = 2;
            dctx.beginPath();
            quad.corners.forEach((p, i) => (i ? dctx.lineTo(p.x, p.y) : dctx.moveTo(p.x, p.y)));
            dctx.closePath();
            dctx.stroke();
          }
        }
        setDebugText(
          `${trace.reason} · ${trace.sides} · T ${trace.T} max ${trace.maxStep} · luma ${Math.round(light.luma)} blown ${light.blown.toFixed(3)} · hint ${next ?? "none"} · ${mirror ? "mirror" : "video"} ${vw}x${vh} · el ${video.clientWidth}x${video.clientHeight} · dumps ${dumped.current}`,
        );
        ticks.current.push({ t: Date.now(), reason: trace.reason, quad: quad?.corners ?? null, target: outlineTarget.current, shown: outlineShown.current });
        // Every 2 s, the whole frame + the geometry to the dev server
        // (api/dev/outline-dump), to tune the finder on real frames offline.
        if (Date.now() - lastDump.current > 2000) {
          lastDump.current = Date.now();
          try {
            const full = document.createElement("canvas");
            full.width = vw;
            full.height = vh;
            full.getContext("2d")?.drawImage(video, 0, 0);
            const rect = video.getBoundingClientRect();
            const track = streamRef.current?.getVideoTracks()[0];
            const meta = {
              at: new Date().toISOString(),
              ua: navigator.userAgent,
              mirror,
              src: { vw, vh },
              element: { clientWidth: video.clientWidth, clientHeight: video.clientHeight, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } },
              trackSettings: track?.getSettings() ?? null,
              geometry: guideGeometry(video, mode),
              crop: { sx, sy, sw, sh, w, h },
              expect,
              quad,
              trace,
              outlineTarget: outlineTarget.current,
              ticks: ticks.current.splice(0),
            };
            void fetch("/api/dev/outline-dump", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ frame: full.toDataURL("image/jpeg", 0.85), meta }),
            }).then((r) => {
              if (r.ok) dumped.current++;
            });
          } catch {
            // Debug only; never in the way.
          }
        }
      }
      if (next === last) streak++;
      else {
        last = next;
        streak = 1;
      }
      if (streak === 2) setHint(next);

      if (quad) {
        // Corners back to guide fractions (a card poking out of the guide
        // lands a little outside 0..1, and the outline draws there too).
        const fresh = quad.corners.map((p) => ({
          x: (sx + (p.x / w) * sw - g.x) / g.w,
          y: (sy + (p.y / h) * sh - g.y) / g.h,
        })) as [Point, Point, Point, Point];
        // A move under 1.5 % of the guide is finder jitter, not the card:
        // the fix stays put. A real move is taken halfway (a little inertia).
        const last = seen;
        const moved = last ? Math.max(...fresh.map((p, i) => Math.hypot(p.x - last[i].x, p.y - last[i].y))) : Infinity;
        seen = !last
          ? fresh
          : moved < 0.015
            ? last
            : (last.map((p, i) => ({ x: (p.x + fresh[i].x) / 2, y: (p.y + fresh[i].y) / 2 })) as [Point, Point, Point, Point]);
        missStreak = 0;
        seenStreak++;
        // Ready = the card roughly in the guide (it may poke out 12 % a
        // side), roughly square (8°), and nothing wrong with the light or
        // the distance. Loose on purpose (Chris 10-15: "leave some room").
        const inGuide = seen.every((p) => p.x > -0.12 && p.x < 1.12 && p.y > -0.12 && p.y < 1.12);
        const ready = inGuide && Math.abs(quad.angle) <= 8 && next === null;
        if (seenStreak >= 2) {
          // The drawn line starts where the card is, then glides to each
          // new fix (the frame loop below); React only hears about shows,
          // hides and colour changes.
          if (!outlineTarget.current) outlineShown.current = seen;
          outlineTarget.current = seen;
          setOutline((cur) => (cur?.ready === ready ? cur : { ready }));
        }
      } else {
        seenStreak = 0;
        missStreak++;
        // One lost tick keeps the shape (no blink) but never the green: an
        // edge out of the frame means a photo would cut the card (10-15,
        // Chris: "cut the top off while green").
        if (missStreak === 1 && seen) setOutline((cur) => (cur?.ready ? { ready: false } : cur));
        if (missStreak >= 2 && seen) {
          seen = null;
          outlineTarget.current = null;
          setOutline(null);
        }
      }
    }, 150);
    return () => {
      window.clearInterval(id);
      outlineTarget.current = null;
      setOutline(null);
    };
  }, [ready, mode, mirror, debugOutline]);

  // The outline glides: every frame the drawn corners move a quarter of the
  // way to the latest fix, so a 6-a-second finder reads as smooth tracking
  // (Chris 10-15: "the lines stutter really bad"). Writes the SVG directly;
  // no React render per frame.
  useEffect(() => {
    if (!outline) return;
    let raf = 0;
    const tick = () => {
      const target = outlineTarget.current;
      const poly = outlinePoly.current;
      if (target && poly) {
        const shown = outlineShown.current ?? target;
        const next = shown.map((p, i) => ({
          x: p.x + (target[i].x - p.x) * 0.25,
          y: p.y + (target[i].y - p.y) * 0.25,
        })) as [Point, Point, Point, Point];
        outlineShown.current = next;
        // Drawn a touch outside the edge (2 % of the guide, Chris 10-15: "a few
        // pixel boundary so it's not tight against the card"), so the stroke
        // sits beside the card instead of on it.
        const cx = (next[0].x + next[1].x + next[2].x + next[3].x) / 4;
        const cy = (next[0].y + next[1].y + next[2].y + next[3].y) / 4;
        poly.setAttribute("points", next.map((p) => `${cx + (p.x - cx) * 1.02},${cy + (p.y - cy) * 1.02}`).join(" "));
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [outline]);

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
    const video = (mirror ? mirrorRef.current : videoRef.current);
    // videoWidth is 0 until the stream delivers its first frame.
    if (!video || srcW(video) === 0 || busy.current) return;
    busy.current = true;
    // Held until toBlob answers (+ cooldown): releasing at once let a double tap start a second capture, two charged scans for one card.
    let handedOff = false;
    try {

    // Crop to the guide, not the whole sensor frame. The viewfinder dims
    // everything outside the card-shaped guide, so the seller frames the card
    // IN the guide — saving the full frame put a small card in a sea of table
    // (Chris, 09-02: "looks like I'm much closer than the photo comes out").
    // Same guide geometry as the viewfinder (guideInVideo), 1:1 — no margin. There was a 5% one so a card nosing
    // past a bracket kept its edge; it read as the photo coming out ~10%
    // farther than what was framed (Chris, 09-03: "make it 10% closer").
    const vw = srcW(video);
    const vh = srcH(video);
    const { x: gx, y: gy, w: gw, h: gh } = guideInVideo(video, mode);
    // 10-15: when the live outline has the card and it pokes past the guide,
    // the crop grows to take the whole card (plus 2 %) — a set number under
    // the bottom bracket was being cut off the photo. Inside the guide
    // nothing changes: the crop is the guide, 1:1.
    const seen = outlineTarget.current;
    const reachX = seen ? Math.max(0, -Math.min(...seen.map((p) => p.x)), Math.max(...seen.map((p) => p.x)) - 1) + 0.02 : 0;
    const reachY = seen ? Math.max(0, -Math.min(...seen.map((p) => p.y)), Math.max(...seen.map((p) => p.y)) - 1) + 0.02 : 0;
    const padX = seen ? Math.min(gw * 0.25, gw * reachX) : 0;
    const padY = seen ? Math.min(gh * 0.25, gh * reachY) : 0;
    const sx = Math.max(0, gx - padX);
    const sy = Math.max(0, gy - padY);
    const sw = Math.min(vw - sx, gw + padX * 2);
    const sh = Math.min(vh - sy, gh + padY * 2);

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
        (video as LiveSource & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback?.(finish);
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
          setTimeout(() => { busy.current = false; }, 600);
          return;
        }
        setTimeout(() => { busy.current = false; }, 600);
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
    handedOff = true;
    } finally {
      if (!handedOff) busy.current = false;
    }
  }, [onCapture, mode, mirror]);

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
          if (!blob) {
            setBlurNote("Couldn't capture that frame — tap again");
            setTimeout(() => setBlurNote(null), 2500);
            return;
          }
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

  // Sweep while the last capture is still identifying; off once a match is
  // showing, so the chip gets the eye.
  const identifying =
    lastScan?.status === "queued" || lastScan?.status === "scanning";
  const sweeping = ready && identifying;
  // The outline is for lining up the next card: it rests while a scan is
  // being read so it never fights the sweep, strike or stamp.
  const tracked = outline && !identifying ? outline : null;
  // Brackets go green once the card is lined up for a clean scan.
  const bracket = tracked?.ready ? "border-emerald-400" : "border-brand-400";

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
          {/* Options (10-15, after TCGplayer's menu, ours): game, starting condition, light, tips, share, help. */}
          <button
            type="button"
            onClick={() => setOptions(true)}
            aria-label="Scanner options"
            aria-haspopup="dialog"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-edge bg-surface-2 text-zinc-200 transition hover:border-edge-strong"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
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
          ) : mirror ? (
            <canvas ref={mirrorRef} className="h-full w-full object-contain sm:h-auto sm:max-h-[60dvh] sm:min-h-64" />
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
                {/* The live outline: the card's own four edges, drawn where
                    the edge finder sees them. Blue = seen, bring it into the
                    guide; green = lined up, tap Capture. Fractions of the
                    guide, so it needs no remeasure when the guide moves; the
                    stroke keeps its width under the uneven scale. */}
                {tracked && (
                  <svg
                    className={`card-outline absolute inset-0 h-full w-full overflow-visible ${tracked.ready ? "is-ready" : ""}`}
                    viewBox="0 0 1 1"
                    preserveAspectRatio="none"
                    aria-hidden
                  >
                    {/* No points from React: the frame loop above writes them (the first frame lands before the fade-in shows anything). */}
                    <polygon
                      ref={outlinePoly}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
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
          {debugOutline && (
            <div className="pointer-events-none absolute left-1 top-1 z-30 max-w-[60%] rounded bg-black/80 p-1 text-[10px] leading-tight text-lime-300">
              <canvas ref={debugCanvas} className="block w-32 border border-zinc-600" />
              <p className="mt-1 break-words">{debugText || "sampling…"}</p>
              {/* Dev only: a photo fed in by hand runs the real scan where there is no camera (the browser pane). */}
              <input
                type="file"
                accept="image/*"
                data-dbg-capture
                className="pointer-events-auto mt-1 block w-full text-[10px]"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) onCapture(f);
                }}
              />
            </div>
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
        {quotaNote && (
          <p role="alert" className="shrink-0 px-3 pb-2 text-center text-xs font-semibold text-red-300 sm:px-0">
            {quotaNote}
          </p>
        )}
        <div className="flex min-h-[4.25rem] shrink-0 items-center px-3 sm:px-0">
          {blurNote ? (
            <p
              role="status"
              className="animate-fade-up w-full rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-center text-sm font-medium text-amber-200"
            >
              {blurNote}
            </p>
          ) : lastScan ? (
            <ScanToast key={lastScan.id} item={lastScan} onOpen={onOpen} onRemove={onRemove} onSwap={onPick ? () => setPicking(true) : undefined} onPickSibling={onPick ? (c) => onPick(lastScan.id, c, lastScan.candidates) : undefined} onEdit={onEdit ? () => setEditing(true) : undefined} verify={verify} />
          ) : nativeCam ? null : (
            <div className="w-full text-center text-sm leading-snug text-zinc-400">
              Fill the guide with one card, then tap Capture.
              {tipsOn ? (
                <span className="mt-1 flex items-center justify-center gap-2 text-xs text-brand-200">
                  <span>Lay It Flat · No Glare · Sleeves OK, No Slabs</span>
                  <button type="button" onClick={dismissTips} aria-label="Hide camera tips" className="rounded-full border border-edge px-2 py-0.5 text-[11px] text-zinc-300 hover:border-edge-strong">
                    Got It
                  </button>
                </span>
              ) : null}
            </div>
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
      {editing && lastScan?.card && onEdit && (
        <CopyEditSheet
          item={lastScan}
          onChange={(patch) => onEdit(lastScan.id, patch)}
          onApplyConditionToAll={onApplyConditionToAll}
          waiting={waiting.length}
          onClose={() => setEditing(false)}
        />
      )}
      {options && (
        <ScannerOptionsSheet
          game={game ?? null}
          onGameChange={onGameChange}
          torch={torch}
          onToggleTorch={toggleTorch}
          tipsOn={tipsOn}
          onTips={(on) => (on ? showTips() : dismissTips())}
          onClose={() => setOptions(false)}
        />
      )}
      {picking && lastScan?.card && onPick && (
        <CandidatePicker
          item={lastScan}
          onPick={(c, list) => {
            setPicking(false);
            onPick(lastScan.id, c, list);
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {sheetOpen && verify && (
        <VerifyAllSheet
          items={waiting}
          total={verify.value}
          onOpen={onOpen}
          onRemove={onRemove}
          onClose={() => setTrayOpen(false)}
          onReview={onClose}
        />
      )}
    </div>
  );
}

/** "5 Scans Waiting To Verify": the chip button's label; shorter once the numbers get long so the money keeps its room. */
export function verifyLabel(count: number, value: number, narrow = false): string {
  const noun = count === 1 ? "Scan" : "Scans";
  // narrow: "Not this card?" shares the row and the long label cut to "Ver…" at phone width (10-12).
  // Two digits or a four-figure total cut it again ("Verify 12 S…", Chris 10-15), so there it is
  // "Verify All": the header pill above already says "12 cards". One $10,000 card is "Verify Scan", not "All" (Chris 10-15).
  if (narrow) return count >= 10 || value >= 1000 ? (count === 1 ? "Verify Scan" : "Verify All") : `Verify ${count} ${noun}`;
  const long = count >= 10 || value >= 1000;
  return `${count} ${noun} ${long ? "To Verify" : "Waiting To Verify"}`;
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
  onSwap?: () => void;
  /** One-tap switch to a candidate the variant warning named. */
  onPickSibling?: (card: PokemonCard) => void;
  /** The details pill: open the "This copy" sheet. Falls back to onOpen when absent. */
  onEdit?: () => void;
  /** The chip button's numbers: scans waiting and their market total. */
  verify: { count: number; value: number } | null;
}

function ScanToast({ item, onOpen, onRemove, onSwap, onPickSibling, onEdit, verify }: ToastProps) {
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

  return <RevealChip item={item} onOpen={onOpen} onRemove={onRemove} onSwap={onSwap} onPickSibling={onPickSibling} onEdit={onEdit} verify={verify} />;
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

function RevealChip({ item, onOpen, onRemove, onSwap, onEdit, verify }: ToastProps) {
  const card = item.card!;
  // A look-alike printing worth much more (Special Illustration vs regular): say so, never switch by itself.
  // The "Check the art … Switch" nudge for a pricier twin is gone (Chris 10-08: "i don't like this switch option, remove that").
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
  // The second row's pill: what this copy is (condition, printing, language
  // when not English), with a dot in the condition's colour. Tapping it opens
  // the card, where all three change (10-15, after TCGplayer's "NM, EN,
  // Holofoil" pill, done our way).
  // The printing: the seller's pick, else the one the headline price came
  // from (never an eBay comps row). One Piece / Yu-Gi-Oh! have no printings
  // to speak of ("normal" only), so the pill skips it there.
  const picked = pickPrice(card);
  const variant = effectiveVariant(item) ?? (picked && !/^eBay/i.test(picked.label) ? picked.variant : undefined);
  const printing = variant && !(variant === "normal" && (item.game === "onepiece" || item.game === "yugioh")) ? formatVariantLabel(variant) : null;
  const copyBits = [item.condition, printing, LANGUAGE_WORD[item.language]].filter(Boolean);

  return (
    <div
      className={`animate-fade-up flex w-full flex-col gap-2 rounded-2xl border bg-black/80 px-3 py-2.5 backdrop-blur-md ${style.border}`}
    >
      {/* Row 1: art, label + name + set, price. The set line may wrap to two
          lines: a truncated "Lost Origin Trainer Gallery · #…" was the first
          thing Chris flagged (10-15), and the number is what a seller checks. */}
      <div className="flex w-full items-start gap-3">
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
          {/* No "75% sure" beside the label (Chris 10-15: "I want the users to
              have confidence in the scanner"); a doubtful read still says
              CHECK MATCH. */}
          <p className={`text-[10px] font-semibold tracking-[0.2em] ${style.label}`}>
            {style.labelText}
          </p>
          {/* The name may take two lines too ("Team Rocket's Spidops"): nothing on this card is cut. */}
          <p className="line-clamp-2 font-display text-base font-semibold leading-tight text-white">
            {card.name}
          </p>
          <p className="line-clamp-2 text-xs leading-snug text-zinc-400">
            {card.setName}
            {card.rarity ? ` · ${card.rarity}` : ""}
            {card.number ? ` · #${card.number}` : ""}
          </p>
        </div>
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
      {/* Row 2: this copy's details on the left, Clear on the right. Clear
          takes the scan off the list on the spot (Chris 10-02); a word, not
          an X (10-14): the card stays in Inventory. It had floated between
          the name and the price (Chris 10-15: "in a weird place"). */}
      {(onOpen || onRemove) && (
        <div className="flex w-full items-center justify-between gap-2">
          {onEdit || onOpen ? (
            <button
              type="button"
              onClick={() => (onEdit ? onEdit() : onOpen!(item.id))}
              aria-label={`Change condition or printing: ${copyBits.join(", ")}`}
              className="flex min-w-0 items-center gap-2 rounded-full border border-white/15 bg-white/5 py-1 pl-2.5 pr-2 text-xs font-medium text-zinc-200 transition hover:border-white/30 hover:bg-white/10"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${CONDITION_DOT[item.condition] ?? "bg-zinc-400"}`} aria-hidden />
              <span className="truncate">{copyBits.join(" · ")}</span>
              <span className="shrink-0 text-zinc-500" aria-hidden>✎</span>
            </button>
          ) : (
            <span />
          )}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              aria-label={`Clear ${card.name} from the list (it stays in your Inventory)`}
              title="Clear from this list. The card stays in your Inventory."
              className="flex h-7 shrink-0 items-center rounded-full border border-white/15 px-2.5 text-[11px] font-medium text-zinc-400 transition hover:bg-white/10 hover:text-white"
            >
              Clear
            </button>
          )}
        </div>
      )}
      {/* Row 3: the next step lives on the result (Chris, 09-04): one button,
          names the outcome. Keeps scanning if ignored. 10-02: it counts the
          scans waiting and carries their total ("5 Scans Waiting To Verify ·
          $23.40"), the label shortens once the numbers get long, and the
          words truncate before the money ever would. */}
      {(onOpen || onSwap) && (
        <div className="flex w-full items-center gap-2">
          {onOpen && (
            <button
              type="button"
              onClick={() => onOpen(item.id)}
              className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-full bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-400"
            >
              <span className="min-w-0 truncate">{verify ? verifyLabel(verify.count, verify.value, !!onSwap) : "Verify Your Scan"}</span>
              {verify && verify.value > 0 && <span className="shrink-0 tabular-nums">{formatMoney(verify.value)}</span>}
            </button>
          )}
          {onSwap && (
            <button
              type="button"
              onClick={onSwap}
              className="shrink-0 rounded-full border border-edge px-3 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-edge-strong hover:text-white"
            >
              Not this card?
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The dot on the result card's details pill: the condition's colour (same ladder as the editor's chips). */
const CONDITION_DOT: Record<string, string> = {
  "Near Mint": "bg-emerald-400",
  "Lightly Played": "bg-sky-400",
  "Moderately Played": "bg-amber-400",
  "Heavily Played": "bg-orange-400",
  Damaged: "bg-red-400",
};

/** Language on the details pill: only when it is not English. */
const LANGUAGE_WORD: Record<string, string | null> = { en: null, ja: "Japanese", zh: "Chinese" };

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

