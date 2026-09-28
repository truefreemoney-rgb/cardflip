import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { actOnComment, listComments, redraft } from "@/lib/server/socialInbox";

/**
 * Owner-only inbox actions (/admin/social/inbox).
 *   GET  → { waiting: [...], handled: [...] }
 *   POST { id, action: "reply" | "hide" | "dismiss" | "redraft", text? }
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminOwner();
    const [waiting, handled] = await Promise.all([listComments("new"), listComments("handled", 40)]);
    return NextResponse.json({ waiting, handled });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdminOwner();
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
  const body = (await req.json().catch(() => null)) as { id?: string; action?: string; text?: string } | null;
  const id = body?.id?.trim();
  const action = body?.action;
  if (!id || !action) return NextResponse.json({ error: "id and action required" }, { status: 400 });
  try {
    if (action === "redraft") return NextResponse.json({ draft: await redraft(id) });
    if (action !== "reply" && action !== "hide" && action !== "dismiss" && action !== "undo" && action !== "block") return NextResponse.json({ error: "unknown action" }, { status: 400 });
    const comment = await actOnComment(id, action, typeof body?.text === "string" ? body.text : undefined);
    return NextResponse.json({ comment });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
