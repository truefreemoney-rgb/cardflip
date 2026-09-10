import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import {
  POST_SIZES,
  cardOfTheDay,
  money,
  pctLabel,
  topMovers,
  type Mover,
  type PostSize,
} from "@/lib/server/social";
import type { GameId } from "@/lib/types";
import { fallbackArtUrl } from "@/lib/cardArt";

/**
 * The social post as a picture (docs/SOCIAL-AUTOPILOT.md): one PNG per
 * post, drawn from our own data the moment it is asked for, no design tool.
 *   GET /api/social/image?kind=movers|card&game=pokemon|mtg&day=YYYY-MM-DD&size=square|story|landscape
 * Owner cookie (the /admin/social preview) or ?key=CRON_SECRET (the
 * publisher routine). Same dark frame as the site (docs/DESIGN.md): the
 * static layer carries the design, one indigo accent, holo only on the
 * price.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BG = "#0a0b11";
const MUTED = "#a1a1aa";
const UP = "#4ade80";
const DOWN = "#f87171";
const HOLO = "linear-gradient(90deg, #7dd3fc, #a78bfa, #f0abfc, #fcd34d)";

/**
 * Card art as a data URI. Satori draws PNG/JPEG only, and TCGdex serves
 * WebP, so the WebP is converted through sharp (Next ships it); when that
 * host or the conversion fails, the pokemontcg.io PNG twin (lib/cardArt.ts)
 * is used. Empty string = draw the placeholder.
 */
async function fetchBytes(url: string): Promise<{ bytes: Buffer; type: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (!res.ok) return null;
    return { bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "" };
  } catch {
    return null;
  }
}

async function artDataUri(url: string): Promise<string> {
  if (!url) return "";
  const primary = await fetchBytes(url);
  if (primary) {
    if (!/webp/.test(primary.type) && !url.endsWith(".webp")) {
      return `data:${primary.type || "image/jpeg"};base64,${primary.bytes.toString("base64")}`;
    }
    try {
      const sharp = (await import("sharp")).default;
      const png = await sharp(primary.bytes).png().toBuffer();
      return `data:image/png;base64,${png.toString("base64")}`;
    } catch {
      /* sharp missing or bad bytes: fall through to the PNG twin */
    }
  }
  const twin = fallbackArtUrl(url);
  const fb = twin ? await fetchBytes(twin) : null;
  return fb ? `data:image/png;base64,${fb.bytes.toString("base64")}` : "";
}

async function withArt(m: Mover): Promise<Mover> {
  return { ...m, imageUrl: await artDataUri(m.imageUrl) };
}

async function allowed(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const key = req.nextUrl.searchParams.get("key");
  if (secret && key && key === secret) return true;
  try {
    await requireAdminOwner();
    return true;
  } catch (err) {
    if (err instanceof AuthError) return false;
    throw err;
  }
}

export async function GET(req: NextRequest) {
  if (!(await allowed(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const q = req.nextUrl.searchParams;
  const kind = q.get("kind") === "card" ? "card" : "movers";
  const game: GameId = q.get("game") === "mtg" ? "mtg" : "pokemon";
  const sizeKey = (["square", "story", "landscape"] as PostSize[]).find((s) => s === q.get("size")) ?? "square";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q.get("day") ?? "") ? (q.get("day") as string) : undefined;
  const size = POST_SIZES[sizeKey];
  const tall = sizeKey === "story";
  const wide = sizeKey === "landscape";
  const label = game === "mtg" ? "Magic" : "Pokémon";

  if (kind === "card") {
    const card = await cardOfTheDay(game, day);
    if (!card) return NextResponse.json({ error: "No card today" }, { status: 404 });
    return new ImageResponse(<CardOfTheDay card={await withArt(card)} label={label} tall={tall} wide={wide} />, size);
  }
  const movers = await topMovers(game, day);
  if (movers.length === 0) return NextResponse.json({ error: "No movers" }, { status: 404 });
  return new ImageResponse(<Movers movers={await Promise.all(movers.map(withArt))} label={label} tall={tall} wide={wide} />, size);
}

function Frame({ children, tall, wide }: { children: React.ReactNode; tall: boolean; wide: boolean }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: BG,
        backgroundImage: "radial-gradient(circle at 20% 0%, rgba(99,102,241,0.35), transparent 55%)",
        color: "white",
        padding: wide ? 44 : tall ? 80 : 64,
        fontFamily: "sans-serif",
      }}
    >
      {children}
      <div style={{ display: "flex", flexShrink: 0, alignItems: "center", gap: 14, marginTop: "auto", paddingTop: 16 }}>
        <div style={{ display: "flex", width: 22, height: 22, borderRadius: 9999, background: "#6366f1" }} />
        <div style={{ display: "flex", fontSize: wide ? 30 : 40, fontWeight: 600 }}>CardFlip</div>
        <div style={{ display: "flex", fontSize: wide ? 24 : 30, color: MUTED, marginLeft: 8 }}>
          Scan a card, see what it&apos;s worth. cardflip.io
        </div>
      </div>
    </div>
  );
}

function Pct({ pct, size }: { pct: number; size: number }) {
  const flat = Math.abs(pct) < 1;
  return (
    <div style={{ display: "flex", fontSize: size, fontWeight: 700, color: flat ? MUTED : pct > 0 ? UP : DOWN }}>
      {flat ? "flat" : pctLabel(pct)}
    </div>
  );
}

function Movers({ movers, label, tall, wide }: { movers: Mover[]; label: string; tall: boolean; wide: boolean }) {
  const rows = wide ? movers.slice(0, 3) : movers;
  const art = wide ? 92 : tall ? 190 : 108;
  const fs = wide ? 24 : tall ? 38 : 27;
  return (
    <Frame tall={tall} wide={wide}>
      <div style={{ display: "flex", flexShrink: 0, fontSize: wide ? 38 : tall ? 64 : 50, fontWeight: 700, letterSpacing: -1 }}>
        {label} price moves this week
      </div>
      <div style={{ display: "flex", flexShrink: 0, fontSize: wide ? 20 : 26, color: MUTED, marginTop: 4 }}>
        Market price, last 7 days, from CardFlip&apos;s price history
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, gap: wide ? 8 : tall ? 26 : 12, marginTop: wide ? 14 : tall ? 40 : 24 }}>
        {rows.map((m) => (
          <div
            key={m.cardId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
              padding: wide ? 6 : tall ? 14 : 10,
              paddingLeft: wide ? 6 : 14,
              paddingRight: wide ? 16 : 24,
              borderRadius: 18,
              background: "rgba(170,180,255,0.07)",
              border: "1px solid rgba(255,255,255,0.11)",
            }}
          >
            {m.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.imageUrl} alt="" width={art * 0.72} height={art} style={{ borderRadius: 8, objectFit: "cover" }} />
            ) : (
              <div style={{ display: "flex", width: art * 0.72, height: art, borderRadius: 8, background: "#1c1d27" }} />
            )}
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", fontSize: fs, fontWeight: 600 }}>{m.name}</div>
              <div style={{ display: "flex", fontSize: fs * 0.72, color: MUTED }}>
                {m.setName} · {m.number}
              </div>
              <div style={{ display: "flex", fontSize: fs * 0.85, marginTop: 4 }}>
                {money(m.from)} → {money(m.to)}
              </div>
            </div>
            <Pct pct={m.pct} size={fs * 1.3} />
          </div>
        ))}
      </div>
    </Frame>
  );
}

function CardOfTheDay({ card, label, tall, wide }: { card: Mover; label: string; tall: boolean; wide: boolean }) {
  const artH = wide ? 440 : tall ? 900 : 620;
  return (
    <Frame tall={tall} wide={wide}>
      <div style={{ display: "flex", flexDirection: tall ? "column" : "row", alignItems: "center", gap: 48, flex: 1 }}>
        {card.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.imageUrl} alt="" width={artH * 0.716} height={artH} style={{ borderRadius: 18, objectFit: "cover", boxShadow: "0 0 80px rgba(99,102,241,0.35)" }} />
        ) : (
          <div style={{ display: "flex", width: artH * 0.716, height: artH, borderRadius: 18, background: "#1c1d27" }} />
        )}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, alignItems: tall ? "center" : "flex-start", textAlign: tall ? "center" : "left" }}>
          <div style={{ display: "flex", fontSize: wide ? 22 : 26, color: MUTED, textTransform: "uppercase", letterSpacing: 3 }}>
            {label} card of the day
          </div>
          <div style={{ display: "flex", fontSize: wide ? 48 : 64, fontWeight: 700, marginTop: 12, letterSpacing: -1 }}>{card.name}</div>
          <div style={{ display: "flex", fontSize: wide ? 26 : 34, color: MUTED, marginTop: 6 }}>
            {card.setName} · {card.number}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: wide ? 88 : 120,
              fontWeight: 800,
              marginTop: 24,
              backgroundImage: HOLO,
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            {money(card.to)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8 }}>
            <Pct pct={card.pct} size={wide ? 30 : 40} />
            <div style={{ display: "flex", fontSize: wide ? 24 : 30, color: MUTED }}>last 7 days</div>
          </div>
        </div>
      </div>
    </Frame>
  );
}
