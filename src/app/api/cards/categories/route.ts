import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { renameCategory, clearCategory } from "@/lib/server/cards";
import { CATEGORY_MAX } from "@/lib/categories";

/**
 * Folder management (Chris, 09-08: "management options for the folders").
 * Categories are just a text column on cards, so managing one is one
 * UPDATE across the seller's rows:
 *   { action: "rename", from, to }  — to may be an existing name (merge)
 *   { action: "delete", from }      — the cards go to Uncategorized
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const from = typeof body?.from === "string" ? body.from.trim() : "";
    if (!from) return NextResponse.json({ error: "Which folder?" }, { status: 400 });

    if (body?.action === "rename") {
      const to = typeof body?.to === "string" ? body.to.trim().slice(0, CATEGORY_MAX) : "";
      if (!to) return NextResponse.json({ error: "Give the folder a name" }, { status: 400 });
      const changed = await renameCategory(user.id, from, to);
      return NextResponse.json({ ok: true, changed, category: to });
    }
    if (body?.action === "delete") {
      const changed = await clearCategory(user.id, from);
      return NextResponse.json({ ok: true, changed });
    }
    return NextResponse.json({ error: "action must be rename or delete" }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
