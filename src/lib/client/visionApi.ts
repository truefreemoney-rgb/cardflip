"use client";

import { apiPath } from "@/lib/client/basePath";
import type { GameId, ScanLanguage, VisionCardRead, VisionStatus } from "@/lib/types";

export interface VisionScanOutcome {
  status: VisionStatus;
  read: VisionCardRead | null;
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
    if (!base64) return { status: "error", read: null };

    const res = await fetch(apiPath("/api/vision/scan"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64, mediaType, language, game }),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        status: data?.status === "unconfigured" ? "unconfigured" : "error",
        read: null,
      };
    }
    return {
      status: (data?.status as VisionStatus) ?? "error",
      read: data?.card ?? null,
    };
  } catch {
    return { status: "error", read: null };
  }
}
