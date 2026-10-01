import { NextResponse, type NextRequest } from "next/server";
import { opsKeyOk } from "@/lib/server/opsKey";
import { isMailConfigured, verifyMailTransport } from "@/lib/server/mail";

/**
 * GET /api/ops/mail-check — logs in to the SMTP server and sends nothing,
 * with the same Bearer OPS_KEY as /api/ops/alert. 200 { ok: true }
 * when the mailbox answers; 503 when mail is not set up here; 502 with the
 * server's complaint when it will not log us in. Confirmation codes, password
 * resets and the ops alerts all ride this one mailbox, and a GitHub workflow
 * that calls this fails (and GitHub's own failure mail arrives) without the
 * site's SMTP being needed to tell anyone.
 */
export async function GET(req: NextRequest) {
  if (!opsKeyOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isMailConfigured()) return NextResponse.json({ ok: false, error: "Mail isn't configured on this server" }, { status: 503 });
  try {
    await verifyMailTransport();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 200) }, { status: 502 });
  }
}
