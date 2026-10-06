import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { deletePack, getPack, updatePack } from "@/lib/server/packs";
import { LIMITS, limitOrRespond } from "@/lib/server/rateLimit";
import { parsePackCost, parsePackName } from "@/lib/packs";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** One pack with its pulls and totals (audit G8). The session decides whose pack it is. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const pack = await getPack(user.id, (await params).id);
    if (!pack) return NextResponse.json({ error: "Pack not found" }, { status: 404 });
    return NextResponse.json({ pack });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}

/** { name?, cost? } → { pack }. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const limited = limitOrRespond(`packs:${user.id}`, LIMITS.packWrite);
    if (limited) return limited;
    const body = await req.json().catch(() => null);
    const patch: { name?: string; cost?: number } = {};
    if (body?.name !== undefined) {
      patch.name = parsePackName(body.name);
      if (!patch.name) return NextResponse.json({ error: "Give the pack a name" }, { status: 400 });
    }
    if (body?.cost !== undefined) {
      const cost = parsePackCost(body.cost);
      if (cost == null) return NextResponse.json({ error: "Type what you paid, like 4.99" }, { status: 400 });
      patch.cost = cost;
    }
    const pack = await updatePack(user.id, (await params).id, patch);
    if (!pack) return NextResponse.json({ error: "Pack not found" }, { status: 404 });
    return NextResponse.json({ pack });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}

/** Deletes the pack; its cards stay in Inventory. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const limited = limitOrRespond(`packs:${user.id}`, LIMITS.packWrite);
    if (limited) return limited;
    if (!(await deletePack(user.id, (await params).id))) return NextResponse.json({ error: "Pack not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}
