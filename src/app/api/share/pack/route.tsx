import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { getPack } from "@/lib/server/packs";
import { PackShare, SHARE_SIZE } from "@/lib/server/shareImage";
import { artDataUri } from "@/lib/server/ogArt";
import { ogFonts } from "@/lib/server/ogFonts";
import { publicImageUrl } from "@/lib/server/publicCollection";
import { LIMITS, limitOrRespond } from "@/lib/server/rateLimit";
import { GAMES } from "@/lib/games";

/**
 * One of the signed-in user's packs as a 1080x1920 "My Pack" picture (audit G8).
 *   GET /api/share/pack?id=<pack id>
 * Own data only: the session decides whose pack this is. The numbers are lib/packs.ts's; the art URLs go
 * through the public-collection host allowlist before the server fetches them.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  let props: Parameters<typeof PackShare>[0];
  try {
    const user = await requireUser();
    const limited = limitOrRespond(`packshare:${user.id}`, LIMITS.packWrite);
    if (limited) return limited;
    const pack = await getPack(user.id, req.nextUrl.searchParams.get("id") ?? "");
    if (!pack) return NextResponse.json({ error: "Pack not found" }, { status: 404 });
    const top = await Promise.all(
      pack.pulls.slice(0, 3).map(async (p) => ({
        name: p.cardName,
        setName: p.setName,
        value: p.value,
        image: await artDataUri(publicImageUrl(p.imageUrl), 400),
      })),
    );
    props = { game: GAMES[pack.game].label, name: pack.name, cost: pack.cost, value: pack.value, profit: pack.profit, roiPct: pack.roiPct, count: pack.count, top };
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    console.error("share pack picture failed:", err);
    return NextResponse.json({ error: "Couldn't draw that picture" }, { status: 500 });
  }
  return new ImageResponse(<PackShare {...props} />, { ...SHARE_SIZE, fonts: await ogFonts() });
}
