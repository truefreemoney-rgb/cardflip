import { NextRequest, NextResponse } from "next/server";
import { digestLinkState, unsubscribeDigest } from "@/lib/server/digest";

/**
 * The "Stop these emails" link in the Sunday digest and the update campaigns. No login needed: the
 * per-user token is the proof.
 *
 * GET only shows a page with an Unsubscribe button (10-17, A-H #24): work and school mail scanners
 * open every link in a mail, and the old GET unsubscribed on open. POST does it: from that button
 * (form fields), or from Gmail/Apple Mail's own one-tap button (RFC 8058: a POST to the same URL,
 * body "List-Unsubscribe=One-Click", which the List-Unsubscribe-Post header in mail.ts asks for).
 */
export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const btn = "display:inline-block;padding:12px 22px;border-radius:999px;border:0;background:#6d5dfc;color:#fff;text-decoration:none;font-weight:600;font-size:16px;font-family:inherit;cursor:pointer";

const page = (title: string, body: string, action = `<a href="/app/collection" style="${btn}">Open CardFlip</a>`) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>
<body style="margin:0;padding:48px 16px;font-family:system-ui,sans-serif;background:#0b0b10;color:#f2f2f7;text-align:center">
<h1 style="font-size:22px;margin:0 0 8px">${title}</h1><p style="color:#a9a9b8;margin:0 0 24px">${body}</p>
${action}
</body></html>`;

const html = (body: string, status = 200) => new NextResponse(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const badLink = () => html(page("That Link Didn't Work", "It may be from an older email. Write to support@cardflip.io and we'll sort it."), 400);
const what = (updates: boolean) => (updates ? "update emails or Sunday digests" : "Sunday digests");
const done = (updates: boolean) => page("You're Unsubscribed", `No more ${what(updates)}. Price alerts and receipts still arrive.`);

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u") ?? "";
  const t = req.nextUrl.searchParams.get("t") ?? "";
  // k=updates = the admin email campaigns (campaigns.ts): same flag, its own wording.
  const updates = req.nextUrl.searchParams.get("k") === "updates";
  const state = await digestLinkState(u, t);
  if (state === "bad") return badLink();
  if (state === "off") return html(done(updates));
  const form = `<form method="post" action="/api/digest/unsubscribe">
<input type="hidden" name="u" value="${esc(u)}"><input type="hidden" name="t" value="${esc(t)}"><input type="hidden" name="k" value="${updates ? "updates" : ""}">
<button type="submit" style="${btn}">Unsubscribe</button></form>`;
  return html(page("Stop These Emails?", `Tap Unsubscribe and we'll stop sending ${what(updates)}. Price alerts and receipts still arrive.`, form));
}

export async function POST(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const form = await req.formData().catch(() => null);
  const field = (k: string) => (typeof form?.get(k) === "string" ? (form.get(k) as string) : "") || q.get(k) || "";
  const ok = await unsubscribeDigest(field("u"), field("t"));
  // The mail app's one-tap button wants a status, not a page.
  if (form?.get("List-Unsubscribe") === "One-Click") return new NextResponse(ok ? "Unsubscribed" : "Not found", { status: ok ? 200 : 400 });
  return ok ? html(done(field("k") === "updates")) : badLink();
}
