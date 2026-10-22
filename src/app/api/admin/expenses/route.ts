import { NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { loadExpenses, saveExpenses } from "@/lib/server/expenses";
import { adminFailure, adminAuthResponse } from "@/lib/server/adminGate";

/**
 * /api/admin/expenses — owner only. GET the list, PUT the whole list back
 * (`{ expenses: Expense[] }`); the editor on /admin/analytics saves the
 * full table on every Save, so there is no per-row endpoint.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminOwner();
    return NextResponse.json({ expenses: await loadExpenses() });
  } catch (err) {
    return adminFailure(err);
  }
}

export async function PUT(req: Request) {
  try {
    await requireAdminOwner();
    const body = await req.json().catch(() => null);
    const saved = await saveExpenses(body?.expenses);
    return NextResponse.json({ expenses: saved });
  } catch (err) {
    if (err instanceof AuthError) return adminAuthResponse(err);
    if (err instanceof Error && /must be a list|too many/.test(err.message)) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("expenses put failed:", err);
    return NextResponse.json({ error: "Couldn't save the expenses" }, { status: 500 });
  }
}
