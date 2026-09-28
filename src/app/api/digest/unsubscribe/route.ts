import { NextRequest, NextResponse } from "next/server";
import { unsubscribeDigest } from "@/lib/server/digest";

/** The "Stop these emails" link in the Sunday digest. No login needed: the per-user token is the proof. */
export const dynamic = "force-dynamic";

const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:48px 16px;font-family:system-ui,sans-serif;background:#0b0b10;color:#f2f2f7;text-align:center">
<h1 style="font-size:22px;margin:0 0 8px">${title}</h1><p style="color:#a9a9b8;margin:0 0 24px">${body}</p>
<a href="/app/collection" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600">Open CardFlip</a>
</body></html>`;

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u") ?? "";
  const t = req.nextUrl.searchParams.get("t") ?? "";
  const ok = await unsubscribeDigest(u, t);
  return new NextResponse(
    ok
      ? page("You're Unsubscribed", "No more Sunday digests. Price alerts and receipts still arrive.")
      : page("That Link Didn't Work", "It may be from an older email. Write to support@cardflip.io and we'll sort it."),
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
