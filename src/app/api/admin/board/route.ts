import { NextResponse } from "next/server";
import { requireAdmin, requireAdminOwner, AuthError } from "@/lib/server/auth";
import { BoardConflictError, loadBoard, normalizeBoard, reseedBoard, saveBoard, serializeBoard, validateBoard } from "@/lib/server/board";

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

/** Replace the live board with docs/BOARD.md (the seed) — Claude updates the file; Chris reloads. */
export async function POST() {
  try {
    await requireAdminOwner();
    const board = await reseedBoard();
    return NextResponse.json(board);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("board reseed failed:", err);
    return NextResponse.json({ error: "Couldn't reload the board" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    // A helper never replaces the board — her writes go through /board/note.
    await requireAdminOwner();
    const body = await req.json().catch(() => null);
    const v = validateBoard(body?.sections);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    const n = normalizeBoard(v.sections);
    // `base` = the updatedAt this copy was loaded from. A stale copy is refused
    // with the live board so the client can reload instead of overwriting.
    const base = typeof body?.base === "number" && Number.isFinite(body.base) ? body.base : undefined;
    const updatedAt = await saveBoard(n.sections, base);
    // The normalised board comes back so a tick shows up in Completed at once.
    return NextResponse.json({ ok: true, updatedAt, sections: n.changed ? n.sections : undefined });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof BoardConflictError) {
      const live = await loadBoard();
      return NextResponse.json({ error: "The board changed elsewhere — reloaded it. Redo that last edit.", sections: live.sections, updatedAt: live.updatedAt }, { status: 409 });
    }
    console.error("board save failed:", err);
    return NextResponse.json({ error: "Couldn't save the board" }, { status: 500 });
  }
}
