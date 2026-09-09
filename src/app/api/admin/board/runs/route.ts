import { NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/server/auth";
import { loadBoard } from "@/lib/server/board";
import { runStatuses } from "@/lib/server/boardRuns";

/**
 * Status of every "▶ RUNNING #n" task on the board, read from GitHub once
 * per board visit (Chris, 09-09: indicators after Run, not live).
 */
export async function GET() {
  try {
    await requireAdmin();
    const { sections } = await loadBoard();
    const numbers = sections
      .flatMap((s) => s.items)
      .map((i) => /^▶ RUNNING #(\d+)/.exec(i.text)?.[1])
      .filter((n): n is string => !!n)
      .map(Number);
    const runs = await runStatuses(numbers);
    return NextResponse.json({ runs }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("board runs failed:", err);
    return NextResponse.json({ error: "Couldn't read run status" }, { status: 500 });
  }
}
