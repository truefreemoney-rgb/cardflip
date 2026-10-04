import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";

/**
 * Owner-only file drop (Chris 10-04: "a button somewhere in admin so I can
 * upload this video I took for you; I can't get it off my phone, the file is
 * large"). The browser uploads STRAIGHT to the Blob store with a token this
 * route mints (a serverless body is capped at 4.5 MB; a phone video is far
 * past that), under drop/<name>-<random>. This is a tool for the owner, not
 * a customer upload path: the scanner's camera stays the only way a card
 * gets a picture (memory cardflip-no-uploads-camera-only).
 *   POST /api/admin/drop  → @vercel/blob/client handleUpload protocol
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requireAdminOwner();
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
  const body = (await req.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: ["video/*", "image/*", "audio/*", "application/zip"],
        maximumSizeInBytes: 2 * 1024 * 1024 * 1024,
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ pathname }),
      }),
      onUploadCompleted: async ({ blob }) => {
        console.log("drop: uploaded", blob.pathname, blob.url);
      },
    });
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
