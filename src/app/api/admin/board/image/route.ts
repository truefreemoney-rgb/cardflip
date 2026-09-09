import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { del, put } from "@vercel/blob";
import { requireAdmin, AuthError } from "@/lib/server/auth";
import { BLOB_URL_RE } from "@/lib/server/board";

/**
 * Photos on board notes (Chris, 09-09: "for my thoughts, i need a image
 * update option for easy reference"). POST multipart {file} → {url} in the
 * cardflip-blob store (public, unguessable path); DELETE {url} removes it.
 * The client downsizes to ≤1600px JPEG first — a phone photo is 4–6 MB and
 * the function body cap is 4.5 MB.
 */
const MAX_BYTES = 4_000_000;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
    const ext = TYPES[file.type];
    if (!ext) return NextResponse.json({ error: "Photos only (JPEG, PNG, WebP, GIF)" }, { status: 415 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image too large (max 4 MB)" }, { status: 413 });
    const blob = await put(`board/${randomUUID()}.${ext}`, file, { access: "public", addRandomSuffix: false, contentType: file.type });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("board image upload failed:", err);
    return NextResponse.json({ error: "Couldn't upload the photo" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    const url = typeof body?.url === "string" ? body.url : "";
    if (!BLOB_URL_RE.test(url)) return NextResponse.json({ error: "Bad image URL" }, { status: 400 });
    await del(url);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("board image delete failed:", err);
    return NextResponse.json({ error: "Couldn't remove the photo" }, { status: 500 });
  }
}
