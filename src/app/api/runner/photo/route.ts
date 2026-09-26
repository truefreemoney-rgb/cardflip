import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { BLOB_URL_RE } from "@/lib/server/board";

export const dynamic = "force-dynamic";

/**
 * Board photos for the runner (runner upgrade 7). The runner's cloud box
 * cannot reach the Vercel Blob host, so run #19 read its task from the text
 * alone. cardflip.io it can reach, so this route hands a board photo through:
 *
 *   curl -H "Authorization: Bearer $RUNNER_TOKEN" -o photo.jpg \
 *     "https://cardflip.io/api/runner/photo?u=<blob url>"
 *
 * Only URLs in our own blob store are served (BLOB_URL_RE), read-only, same
 * secret as /api/runner/status.
 */
export async function GET(req: Request) {
  const expected = process.env.RUNNER_TOKEN;
  if (!expected) return NextResponse.json({ error: "RUNNER_TOKEN is not set" }, { status: 503 });
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  const u = new URL(req.url).searchParams.get("u") ?? "";
  if (!BLOB_URL_RE.test(u)) return NextResponse.json({ error: "Not a board photo" }, { status: 400 });
  const upstream = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!upstream || !upstream.ok) return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "private, no-store",
    },
  });
}
