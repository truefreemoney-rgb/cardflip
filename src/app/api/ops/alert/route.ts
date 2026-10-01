import { NextResponse, type NextRequest } from "next/server";
import { secretEqual } from "@/lib/server/secretEqual";
import { opsAlert } from "@/lib/server/opsAlert";

/**
 * POST /api/ops/alert — GitHub Actions' failure() step (ci.yml,
 * prod-smoke.yml) with Bearer SOCIAL_POST_KEY, the one key GitHub already
 * holds. Body: { workflow, sha?, url?, message? }. Mails Chris, once an hour
 * per workflow (lib/server/opsAlert.ts).
 */
const RUN_URL = /^https:\/\/github\.com\/truefreemoney-rgb\/cardflip\/actions\/runs\/\d+(\/[\w/-]*)?$/;

export async function POST(req: NextRequest) {
  const k = process.env.SOCIAL_POST_KEY;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secretEqual(given, k)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const workflow = typeof body?.workflow === "string" ? body.workflow.slice(0, 80) : "";
  if (!workflow) return NextResponse.json({ error: "workflow is required" }, { status: 400 });
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
  // The link in the mail is a run on this repo's Actions or nothing (10-01 sweep: a leaked key could mail Chris a
  // phishing link inside a trusted "CardFlip: … Failed" alert).
  const rawUrl = str(body.url, 300);
  const url = rawUrl && RUN_URL.test(rawUrl) ? rawUrl : undefined;
  const result = await opsAlert({ workflow, sha: str(body.sha, 40), url, message: str(body.message, 500) });
  return NextResponse.json({ result });
}
