import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { addCategory, clearCategory, listCategories, renameCategory } from "@/lib/server/cards";
import { CATEGORY_MAX } from "@/lib/categories";

/**
 * Category management (Chris, 09-08: "management options for the folders",
 * then "an add Category button"). A category is a text column on cards
 * plus, for empty ones, a row in `categories`:
 *   GET                              → { categories: string[] } (union, A→Z)
 *   { action: "add", from }          — an empty category, ready for cards
 *   { action: "rename", from, to }   — to may be an existing name (merge)
 *   { action: "delete", from }       — the cards go to Uncategorized
 */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ categories: await listCategories(user.id) });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const from = typeof body?.from === "string" ? body.from.trim().slice(0, CATEGORY_MAX) : "";
    if (!from) return NextResponse.json({ error: "Which category?" }, { status: 400 });

    if (body?.action === "add") {
      await addCategory(user.id, from);
      return NextResponse.json({ ok: true, changed: 0, category: from });
    }
    if (body?.action === "rename") {
      const to = typeof body?.to === "string" ? body.to.trim().slice(0, CATEGORY_MAX) : "";
      if (!to) return NextResponse.json({ error: "Give the category a name" }, { status: 400 });
      const changed = await renameCategory(user.id, from, to);
      return NextResponse.json({ ok: true, changed, category: to });
    }
    if (body?.action === "delete") {
      const changed = await clearCategory(user.id, from);
      return NextResponse.json({ ok: true, changed });
    }
    return NextResponse.json({ error: "action must be add, rename or delete" }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
