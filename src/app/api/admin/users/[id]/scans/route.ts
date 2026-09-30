import { NextResponse } from "next/server";
import { requireAdminOwner, AuthError } from "@/lib/server/auth";
import { adjustPlanScans, ledgerForUser } from "@/lib/server/scanCredits";
import { findUserById, toPublicUser } from "@/lib/server/users";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Owner only: add or take back plan scans by hand, with a note, as a ledger row
 * (kind "admin"). This is how "Chris refunds a payment" takes its scans back
 * (a negative delta, floored at zero), how a won dispute or a goodwill grant is
 * put right, and how a missed credit is fixed when the automatic ones cannot.
 * POST { delta: whole number != 0, note: why }; the answer carries what moved
 * and the account's newest ledger rows.
 */
export async function POST(req: Request, { params }: RouteParams) {
  try {
    await requireAdminOwner();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const delta = body?.delta;
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100_000) {
      return NextResponse.json({ error: "delta must be a whole number of scans, not zero" }, { status: 400 });
    }
    if (note.length < 3 || note.length > 300) {
      return NextResponse.json({ error: "Say why, in 3 to 300 characters" }, { status: 400 });
    }
    const user = await findUserById(id);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const out = await adjustPlanScans(id, delta, note);
    const updated = await findUserById(id);
    return NextResponse.json({
      applied: out.applied,
      balanceBefore: out.balanceBefore,
      balanceAfter: out.balanceAfter,
      user: updated ? toPublicUser(updated) : null,
      ledger: await ledgerForUser(id, 20),
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("adjust scans failed:", err);
    return NextResponse.json({ error: "Couldn't adjust the scans" }, { status: 500 });
  }
}
