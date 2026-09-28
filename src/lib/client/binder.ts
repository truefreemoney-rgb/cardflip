"use client";

import { apiPath } from "@/lib/client/basePath";
import { cropRect, type CardBox } from "@/lib/binder";
import type { ScanUsage } from "@/lib/client/visionApi";

export interface BinderSplit {
  status: "done" | "empty" | "quota" | "unconfigured" | "error";
  /** One JPEG per card found, in reading order, cut from the full-size photo. */
  files: File[];
  /** Cards found on the page (before any allowance trim). */
  found: number;
  /** Allowance after the locate call, when the server reported it. */
  usage: ScanUsage | null;
  error: string | null;
}

/** Long edge for the locate call: boxes need layout, not fine print. */
const LOCATE_EDGE = 1280;

/**
 * One photo of a binder page → one File per card. The photo goes to the
 * locate route downscaled; the crops come from the ORIGINAL pixels, so a
 * 9-card page shot at full camera size still hands each card a few hundred
 * pixels of width for the read. Trims to the seller's remaining scans so a
 * page never queues cards that would refuse at the scan route. Never throws.
 */
export async function splitBinderPhoto(file: File): Promise<BinderSplit> {
  const fail = (status: BinderSplit["status"], error: string | null = null): BinderSplit => ({
    status,
    files: [],
    found: 0,
    usage: null,
    error,
  });
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, LOCATE_EDGE / Math.max(bitmap.width, bitmap.height));
    const small = document.createElement("canvas");
    small.width = Math.round(bitmap.width * scale);
    small.height = Math.round(bitmap.height * scale);
    const sctx = small.getContext("2d");
    if (!sctx) return fail("error");
    sctx.drawImage(bitmap, 0, 0, small.width, small.height);
    const base64 = small.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "";
    if (!base64) return fail("error");

    const res = await fetch(apiPath("/api/vision/locate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64, mediaType: "image/jpeg" }),
      signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(45_000) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 402 && data?.quota) return { ...fail("quota", typeof data?.error === "string" ? data.error : null), usage: data?.usage ?? null };
      return fail(data?.status === "unconfigured" ? "unconfigured" : "error");
    }
    if (data?.status === "unconfigured") return fail("unconfigured");
    const boxes = (Array.isArray(data?.cards) ? data.cards : []) as CardBox[];
    const usage: ScanUsage | null = data?.usage ?? null;
    if (boxes.length === 0) return { ...fail("empty"), usage };

    const remaining = usage?.remaining;
    const keep = typeof remaining === "number" ? boxes.slice(0, Math.max(0, remaining)) : boxes;
    const stamp = Date.now();
    const files: File[] = [];
    for (let i = 0; i < keep.length; i++) {
      const { sx, sy, sw, sh } = cropRect(keep[i], bitmap.width, bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      canvas.getContext("2d")?.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (blob) files.push(new File([blob], `binder-${stamp}-${i + 1}.jpg`, { type: "image/jpeg" }));
    }
    return { status: "done", files, found: boxes.length, usage, error: null };
  } catch {
    return fail("error");
  } finally {
    bitmap?.close();
  }
}
