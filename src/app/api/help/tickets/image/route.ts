import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { AuthError, requireUser } from "@/lib/server/auth";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";

/**
 * Photos on a support ticket or a note (Chris 09-26). POST multipart {file}
 * → {url} in the cardflip-blob store under tickets/ (public, unguessable
 * path; the ticket module only accepts URLs from that folder). The client
 * downsizes to ≤1600px JPEG first — a phone photo is 4–6 MB and the
 * function body cap is 4.5 MB.
 */
const MAX_BYTES = 4_000_000;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

export async function POST(req: NextRequest) {
  const limited = limitOrRespond(`ticketimage:${clientIp(req)}`, LIMITS.supportImage);
  if (limited) return limited;
  try {
    await requireUser();
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
    const ext = TYPES[file.type];
    if (!ext) return NextResponse.json({ error: "Photos only (JPEG, PNG, WebP, GIF)" }, { status: 415 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image too large (max 4 MB)" }, { status: 413 });
    const blob = await put(`tickets/${randomUUID()}.${ext}`, file, { access: "public", addRandomSuffix: false, contentType: file.type });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    console.error("ticket image upload failed:", err);
    return NextResponse.json({ error: "Couldn't upload the photo" }, { status: 500 });
  }
}
