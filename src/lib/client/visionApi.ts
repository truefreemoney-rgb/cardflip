"use client";

import { apiPath } from "@/lib/client/basePath";
import type { GameId, ScanLanguage, VisionCardRead, VisionStatus } from "@/lib/types";

/** Mirror of the server's ScanQuota; remaining is null when the cap isn't enforced. */
export interface ScanUsage {
  used: number;
  included: number;
  remaining: number | null;
}

export interface VisionScanOutcome {
  status: VisionStatus;
  read: VisionCardRead | null;
  /** Post-scan usage from the route, when the server reported it. */
  usage: ScanUsage | null;
  /** The server's message on a quota (402) refusal. */
  error: string | null;
}

/**
 * Long edge the photo is downscaled to before upload. A card's name and
 * collector number are legible well below phone-camera resolution, and image
 * tokens scale with pixels — sending a 4000px original would cost several
 * times more per scan for no extra accuracy.
 */
const MAX_EDGE = 1024;

async function downscale(file: File): Promise<{ base64: string; mediaType: string }> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    return { base64: dataUrl.split(",")[1] ?? "", mediaType: "image/jpeg" };
  } finally {
    bitmap.close();
  }
}

/**
 * Never throws — a vision failure means the scanner falls back to OCR rather
 * than losing the card.
 */
export async function scanCardWithVision(
  file: File,
  language: ScanLanguage,
  game: GameId = "pokemon",
): Promise<VisionScanOutcome> {
  try {
    const { base64, mediaType } = await downscale(file);
    if (!base64) return { status: "error", read: null, usage: null, error: null };

    const res = await fetch(apiPath("/api/vision/scan"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64, mediaType, language, game }),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      // 402 = monthly scan allowance exhausted. Still falls back to OCR like
      // any other failure, but the caller can now tell the user why.
      if (res.status === 402 && data?.quota) {
        return {
          status: "quota",
          read: null,
          usage: data?.usage ?? null,
          error: typeof data?.error === "string" ? data.error : null,
        };
      }
      return {
        status: data?.status === "unconfigured" ? "unconfigured" : "error",
        read: null,
        usage: null,
        error: null,
      };
    }
    return {
      status: (data?.status as VisionStatus) ?? "error",
      read: data?.card ?? null,
      usage: data?.usage ?? null,
      error: null,
    };
  } catch {
    return { status: "error", read: null, usage: null, error: null };
  }
}
