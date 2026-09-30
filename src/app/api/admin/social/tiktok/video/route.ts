import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { getSetting } from "@/lib/server/settings";
import { TIKTOK_SLOTS, parseTiktokSpec, tiktokKey } from "@/lib/socialTiktok";

/**
 * Owner only. Streams one registered TikTok MP4 from the same origin as the
 * admin page (Chris posts TikTok by hand, lib/socialTiktok.ts).
 *   GET ?slot=morning|midday|evening&day=YYYY-MM-DD[&download=1]
 * Why it exists: the Share Video button must hold the MP4 as a File before
 * the tap (on iOS Safari an await between the tap and navigator.share loses
 * the gesture). The card fetches the Blob URL directly first; when the Blob
 * host sends no CORS headers that fetch fails and the card falls back here,
 * where the bytes come through our own origin. Range requests pass through,
 * so a <video> can also play from this URL. ?download=1 sets an attachment
 * filename for the Download Video fallback.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    await requireAdminOwner();
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
  const q = req.nextUrl.searchParams;
  const slot = TIKTOK_SLOTS.find((s) => s === q.get("slot"));
  const day = q.get("day") ?? "";
  if (!slot || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json({ error: "bad slot or day" }, { status: 400 });
  const spec = parseTiktokSpec(await getSetting(tiktokKey(slot, day)));
  if (!spec) return NextResponse.json({ error: "no video registered" }, { status: 404 });
  const range = req.headers.get("range");
  const upstream = await fetch(spec.url, { headers: range ? { range } : {}, cache: "no-store", signal: AbortSignal.timeout(50_000) });
  if (!upstream.ok && upstream.status !== 206) return NextResponse.json({ error: `video host ${upstream.status}` }, { status: 502 });
  const headers = new Headers({ "content-type": "video/mp4", "cache-control": "private, no-store", "accept-ranges": "bytes" });
  for (const h of ["content-length", "content-range"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (q.get("download") === "1") headers.set("content-disposition", `attachment; filename="cardflip-tiktok-${day}-${slot}.mp4"`);
  return new Response(upstream.body, { status: upstream.status, headers });
}
