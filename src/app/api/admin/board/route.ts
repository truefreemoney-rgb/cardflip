import { NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/server/auth";
import { loadBoard, saveBoard, serializeBoard, validateBoard } from "@/lib/server/board";

/**
 * The admin board. GET returns it (?format=md for markdown, the same
 * dialect as docs/BOARD.md); PUT replaces the whole thing — the console
 * edits a local copy and saves it after each change.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin();
    const board = await loadBoard();
    if (new URL(req.url).searchParams.get("format") === "md") {
      return new NextResponse(serializeBoard(board.sections), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
    }
    return NextResponse.json(board);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
}

export async function PUT(req: Request) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    const v = validateBoard(body?.sections);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    await saveBoard(v.sections);
    return NextResponse.json({ ok: true, updatedAt: Date.now() });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("board save failed:", err);
    return NextResponse.json({ error: "Couldn't save the board" }, { status: 500 });
  }
}
