import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { createPack, listPacks } from "@/lib/server/packs";
import { LIMITS, limitOrRespond } from "@/lib/server/rateLimit";
import { isGameId } from "@/lib/games";
import { lifetimeTotals, parsePackCost, parsePackName } from "@/lib/packs";

export const dynamic = "force-dynamic";

/** Pack tracker (audit G8). GET → { packs, lifetime }; POST { game, name, cost } → { pack }. Own data only. */
export async function GET() {
  try {
    const user = await requireUser();
    const packs = await listPacks(user.id);
    return NextResponse.json({ packs, lifetime: lifetimeTotals(packs) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const limited = limitOrRespond(`packs:${user.id}`, LIMITS.packWrite);
    if (limited) return limited;
    const body = await req.json().catch(() => null);
    const name = parsePackName(body?.name);
    if (!name) return NextResponse.json({ error: "Give the pack a name" }, { status: 400 });
    if (!isGameId(body?.game)) return NextResponse.json({ error: "Pick a game" }, { status: 400 });
    const cost = parsePackCost(body?.cost);
    if (cost == null) return NextResponse.json({ error: "Type what you paid, like 4.99" }, { status: 400 });
    const pack = await createPack(user.id, { game: body.game, name, cost });
    if (!pack) return NextResponse.json({ error: "That's the most packs we can keep. Delete an old one first." }, { status: 400 });
    return NextResponse.json({ pack }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}
