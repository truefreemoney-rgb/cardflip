"use client";

import { apiPath } from "@/lib/client/basePath";

/**
 * The seller's own photo of a card, sent to the server as the listing image.
 *
 * eBay's picture policy requires photos of the actual item (never catalogue
 * art for used goods — every raw or graded card), and eBay's picture service
 * wants JPEG ≥500px on the long edge. So the photo the scanner already has is
 * downscaled to ≤1600px and re-encoded as JPEG here (which also turns an
 * iPhone HEIC into something eBay ingests, wherever the browser can decode
 * it) and PUT to `/api/cards/[id]/photo`. The server serves it back to eBay
 * from `/api/card-image/[id]`.
 */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.88;

async function toListingJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) throw new Error("Couldn't encode the photo");
    return blob;
  } finally {
    bitmap.close();
  }
}

export type UploadPhotoResult =
  | { ok: true; photoAt: number }
  | { ok: false; message: string };

export async function uploadCardPhoto(cardId: string, file: File): Promise<UploadPhotoResult> {
  let jpeg: Blob;
  try {
    jpeg = await toListingJpeg(file);
  } catch {
    return { ok: false, message: "Couldn't read that photo — try a JPG or PNG" };
  }
  try {
    const res = await fetch(apiPath(`/api/cards/${encodeURIComponent(cardId)}/photo`), {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: jpeg,
    });
    const json = (await res.json().catch(() => null)) as { photoAt?: number; error?: string } | null;
    if (!res.ok || !json?.photoAt) {
      return { ok: false, message: json?.error ?? `Photo upload failed (${res.status})` };
    }
    return { ok: true, photoAt: json.photoAt };
  } catch {
    return { ok: false, message: "Couldn't reach CardFlip — check your connection" };
  }
}
