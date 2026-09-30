import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { eastern } from "@/lib/server/socialPublish";
import { markTiktokPosted } from "@/lib/server/socialTiktok";
import { TIKTOK_SLOTS } from "@/lib/socialTiktok";
import { addDays } from "@/lib/priceSeries";

/**
 * Owner only. "Mark Posted" on the /admin/social TikTok card (Chris posts
 * TikTok by hand, lib/socialTiktok.ts).
 *   POST { slot: "morning"|"midday"|"evening", day: "YYYY-MM-DD", posted?: false }
 * Records social_slot:tiktok:<slot> = the Eastern day (the key shape the
 * publisher uses for its sites), or clears it when posted is false (Undo).
 * Only yesterday, today or tomorrow: the key holds one day per slot.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requireAdminOwner();
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
  const body = (await req.json().catch(() => null)) as { slot?: string; day?: string; posted?: boolean } | null;
  const slot = TIKTOK_SLOTS.find((s) => s === body?.slot);
  const today = eastern().day;
  const days = [addDays(today, -1), today, addDays(today, 1)];
  if (!slot || !body?.day || !days.includes(body.day)) return NextResponse.json({ error: "bad slot or day" }, { status: 400 });
  const posted = body.posted !== false;
  await markTiktokPosted(slot, body.day, posted);
  return NextResponse.json({ slot, day: body.day, posted });
}
