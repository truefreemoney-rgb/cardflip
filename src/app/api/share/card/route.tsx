import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import { CardShare, SHARE_SIZE } from "@/lib/server/shareImage";
import { artDataUri } from "@/lib/server/ogArt";
import { ogFonts } from "@/lib/server/ogFonts";
import { loadCardPage, loadCardRecord } from "@/lib/server/cardPages";
import { parseGame, GAMES } from "@/lib/games";
import { LIMITS, clientIp } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";

/**
 * A scanned card as a 1080x1920 share picture (audit G2).
 *   GET /api/share/card?game=pokemon&id=<catalog key>
 * Public on purpose: it draws catalog data only (the card page's own guard-checked
 * market price), never anything about a user. A card the catalog does not know is a 404.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const game = parseGame(q.get("game"));
  const id = q.get("id") ?? "";
  if (!id || id.length > 80) return NextResponse.json({ error: "Missing card" }, { status: 400 });
  // Each picture is a fresh render (task #29): an exact cross-instance cap per IP, and the CDN keeps a drawn
  // picture an hour so a shared link being opened again costs nothing.
  const limited = await limitOrRespondAsync(`share:card:${clientIp(req)}`, LIMITS.shareRender);
  if (limited) return limited;
  let props: Parameters<typeof CardShare>[0];
  try {
    const rec = await loadCardRecord(game, id);
    if (!rec) return NextResponse.json({ error: "Card not found" }, { status: 404 });
    const page = await loadCardPage(rec);
    const f = rec.facts;
    props = { name: f.name, setName: f.setName, game: GAMES[game].label, image: await artDataUri(f.image), price: page.headline?.price ?? null };
  } catch (err) {
    console.error("share card picture failed:", err);
    return NextResponse.json({ error: "Couldn't draw that picture" }, { status: 500 });
  }
  return new ImageResponse(<CardShare {...props} />, {
    ...SHARE_SIZE,
    fonts: await ogFonts(),
    headers: { "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
