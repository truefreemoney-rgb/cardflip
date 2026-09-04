import { NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/server/auth";
import { ACCESS_OVERRIDES, findUserById, setAccessOverride, toPublicUser, type AccessOverride } from "@/lib/server/users";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Admin: set or clear an account's plan override (Chris, 09-04: "plans need
 * to be editable here"). `override: null` returns the account to automatic
 * (Stripe / legacy / trial by the usual rules).
 */
export async function PATCH(req: Request, { params }: RouteParams) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const raw = body?.override;
    const override: AccessOverride | null | undefined =
      raw === null ? null : typeof raw === "string" && (ACCESS_OVERRIDES as readonly string[]).includes(raw) ? (raw as AccessOverride) : undefined;
    if (override === undefined) {
      return NextResponse.json({ error: `override must be null or one of ${ACCESS_OVERRIDES.join(", ")}` }, { status: 400 });
    }
    const user = await findUserById(id);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    await setAccessOverride(id, override);
    const updated = await findUserById(id);
    return NextResponse.json({ user: updated ? toPublicUser(updated) : null });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("set access override failed:", err);
    return NextResponse.json({ error: "Couldn't change the plan" }, { status: 500 });
  }
}
