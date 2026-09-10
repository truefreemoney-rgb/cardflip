import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { AuthError } from "@/lib/server/auth";
import { requireAdminPanel } from "@/lib/server/adminGate";
import { helperName } from "@/lib/adminAuth";
import { BLOB_URL_RE, BoardConflictError, helperSection, loadBoard, MAX_IMAGES, saveBoard } from "@/lib/server/board";

/**
 * The helper's only way to write (lib/adminAuth.ts helper role): add a note
 * to her own category, or reply under one of her notes. The board is
 * re-read and saved server-side, so a stale phone tab can't wipe anything
 * (the whole-board PUT is owner-only). The owner may use it too.
 *
 * POST { text, images? }             → a new note in "<Name>'s thoughts"
 * POST { replyTo, text, images? }    → "↳ <Name>: text" appended to that note
 */
export async function POST(req: Request) {
  try {
    const role = await requireAdminPanel();
    const body = await req.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const replyTo = typeof body?.replyTo === "string" ? body.replyTo : "";
    const images: string[] = Array.isArray(body?.images) ? body.images.filter((u: unknown) => typeof u === "string" && BLOB_URL_RE.test(u)).slice(0, MAX_IMAGES) : [];
    if (!text && images.length === 0) return NextResponse.json({ error: "Write something first" }, { status: 400 });
    if (text.length > 800) return NextResponse.json({ error: "Keep a note under 800 characters" }, { status: 400 });
    const name = role === "helper" ? helperName() : "Chris";
    const { sections, updatedAt } = await loadBoard();
    const mine = helperSection(sections);
    if (replyTo) {
      const item = mine.items.find((i) => i.id === replyTo);
      if (!item) return NextResponse.json({ error: "You can only reply under your own notes" }, { status: 403 });
      if (item.done) return NextResponse.json({ error: "That note is completed" }, { status: 409 });
      const extra = images.length ? ` (+${images.length} photo${images.length === 1 ? "" : "s"})` : "";
      item.text = `${item.text}\n↳ ${name}: ${text || "(photo)"}${text ? extra : ""}`;
      if (images.length) item.images = [...(item.images ?? []), ...images].slice(0, MAX_IMAGES);
      if (item.text.length > 1000) return NextResponse.json({ error: "This thread is full — start a new note" }, { status: 400 });
    } else {
      mine.items.push({ id: randomUUID(), done: false, owner: null, text: text || "(photo)", ...(images.length ? { images } : {}) });
    }
    const stamp = await saveBoard(sections, updatedAt);
    return NextResponse.json({ ok: true, sections, updatedAt: stamp });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof BoardConflictError) return NextResponse.json({ error: "The board changed while you typed — try again." }, { status: 409 });
    console.error("board note failed:", err);
    return NextResponse.json({ error: "Couldn't save the note" }, { status: 500 });
  }
}
