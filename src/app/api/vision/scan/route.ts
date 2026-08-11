import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import {
  VisionNotConfiguredError,
  analyzeCardImage,
  isVisionConfigured,
} from "@/lib/server/vision";
import type { ScanLanguage } from "@/lib/types";

/** Photos arrive downscaled by the client; this is a backstop, not the budget. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    await requireUser();

    if (!isVisionConfigured()) {
      return NextResponse.json({ status: "unconfigured", card: null });
    }

    const body = await req.json().catch(() => null);
    const image = body?.image as string | undefined;
    const mediaType = (body?.mediaType as string | undefined) ?? "image/jpeg";
    const language: ScanLanguage =
      body?.language === "ja" || body?.language === "zh" ? body.language : "en";

    if (!image) {
      return NextResponse.json({ error: "Missing image" }, { status: 400 });
    }
    // base64 inflates by ~4/3, so compare against the decoded size.
    if ((image.length * 3) / 4 > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image too large" }, { status: 413 });
    }

    const card = await analyzeCardImage(image, mediaType, language);
    return NextResponse.json({ status: "done", card });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof VisionNotConfiguredError) {
      return NextResponse.json({ status: "unconfigured", card: null });
    }
    // A vision failure shouldn't sink the scan — the caller falls back to OCR.
    console.error("Vision scan failed:", err);
    return NextResponse.json({ status: "error", card: null }, { status: 502 });
  }
}
