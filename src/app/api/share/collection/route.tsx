import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { collectionInsights } from "@/lib/server/insights";
import { CollectionShare, SHARE_SIZE } from "@/lib/server/shareImage";
import { artDataUri } from "@/lib/server/ogArt";
import { ogFonts } from "@/lib/server/ogFonts";
import { publicImageUrl } from "@/lib/server/publicCollection";
import { GAMES, parseGame } from "@/lib/games";

/**
 * The signed-in user's collection value as a 1080x1920 share picture (audit G2).
 *   GET /api/share/collection?game=pokemon
 * Own data only: the session decides whose cards these are, there is no user id in the URL.
 * The numbers are the Insights ones (lib/server/insights.ts); the art URLs go through the
 * public-collection host allowlist before the server fetches them.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  let props: Parameters<typeof CollectionShare>[0];
  try {
    const user = await requireUser();
    const game = parseGame(req.nextUrl.searchParams.get("game"));
    const data = await collectionInsights(user.id, game);
    const copies = data.split.live.count + data.split.draft.count + data.split.ended.count;
    if (copies <= 0) return NextResponse.json({ error: "Nothing to share yet" }, { status: 404 });
    const top = await Promise.all(
      data.top
        .map((c) => ({ name: c.name, setName: c.setName, imageUrl: c.imageUrl, value: c.price * c.quantity }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 3)
        .map(async (c) => ({ name: c.name, setName: c.setName, value: c.value, image: await artDataUri(publicImageUrl(c.imageUrl), 400) })),
    );
    props = { game: GAMES[game].label, total: data.holding, copies, top };
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    console.error("share collection picture failed:", err);
    return NextResponse.json({ error: "Couldn't draw that picture" }, { status: 500 });
  }
  return new ImageResponse(<CollectionShare {...props} />, { ...SHARE_SIZE, fonts: await ogFonts() });
}
