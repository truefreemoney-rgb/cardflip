import { ImageResponse } from "next/og";
import { presentedKey, secretEqual } from "@/lib/server/secretEqual";
import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import {
  POST_SIZES,
  angleData,
  cardOfTheDay,
  gameJumps,
  gameLeads,
  isJump,
  mixedMovers,
  money,
  pctLabel,
  recentlyFeatured,
  setSpotlight,
  thenMonth,
  topMovers,
  variantLabel,
  displayName,
  versusVerdict,
  withSeriesCache,
  type GameLead,
  type Mover,
  type Pair,
  type PostSize,
} from "@/lib/server/social";
import type { GameId } from "@/lib/types";
import { fallbackArtUrl } from "@/lib/cardArt";
import { frozenMovers } from "@/lib/server/socialPublish";
import { parseGame } from "@/lib/games";
import { todayUtc } from "@/lib/priceSeries";
import { ANGLE_KINDS, POST_GAME_NAMES, dayPlan, fanOrder, isAngleKind, jumpsOn, listNames, otherGameNames } from "@/lib/socialPlan";

/**
 * The social post as a picture (docs/SOCIAL-AUTOPILOT.md): one PNG per
 * post, drawn from our own data the moment it is asked for, no design tool.
 *   GET /api/social/image?kind=movers|card&game=pokemon|mtg&day=YYYY-MM-DD&size=square|story|landscape
 * Owner cookie (the /admin/social preview) or ?key=CRON_SECRET (the
 * publisher routine). Same dark frame as the site (docs/DESIGN.md): the
 * static layer carries the design, one indigo accent, holo only on the
 * price.
 * The movers picture draws the cards the registered 1:05pm VIDEO froze (the
 * night render draws it the evening before, and its caption is frozen with it),
 * not a fresh top five: the daily price ingestion runs in between, and a
 * picture-only site (or a "video failed, picture posted") would otherwise show
 * other prices than its caption names. No current video row = the live list.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BG = "#0a0b11";
const MUTED = "#a1a1aa";
const UP = "#4ade80";
const DOWN = "#f87171";
const HOLO = "linear-gradient(90deg, #7dd3fc, #a78bfa, #f0abfc, #fcd34d)";

/**
 * Card art as a data URI. Satori draws PNG/JPEG only, so EVERY picture goes
 * through sharp (09-30, all five games): TCGdex serves WebP, Lorcast AVIF
 * (Satori throws on it and the whole picture fails), optcgapi PNG bytes
 * under an image/jpeg header (Satori throws too). Scryfall refuses Node's
 * default User-Agent (400 generic_user_agent), so the fetch names us. When
 * the host or the conversion fails, the pokemontcg.io PNG twin
 * (lib/cardArt.ts) is tried. Empty string = draw the placeholder.
 */
const ART_HEADERS = { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)", Accept: "image/*" };

async function fetchBytes(url: string): Promise<{ bytes: Buffer; type: string } | null> {
  try {
    const res = await fetch(url, { headers: ART_HEADERS, signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (!res.ok) return null;
    return { bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "" };
  } catch {
    return null;
  }
}

/** JPEG at `width` (PNG when the source has alpha, so rounded corners stay clear). */
async function normalise(bytes: Buffer, width: number): Promise<string> {
  const sharp = (await import("sharp")).default;
  const img = sharp(bytes).resize({ width, withoutEnlargement: true });
  if ((await sharp(bytes).metadata()).hasAlpha) return `data:image/png;base64,${(await img.png().toBuffer()).toString("base64")}`;
  return `data:image/jpeg;base64,${(await img.jpeg({ quality: 88 }).toBuffer()).toString("base64")}`;
}

async function artDataUri(url: string, width = 720): Promise<string> {
  if (!url) return "";
  const primary = await fetchBytes(url);
  if (primary) {
    try {
      return await normalise(primary.bytes, width);
    } catch {
      /* bad bytes: fall through to the PNG twin */
    }
  }
  const twin = fallbackArtUrl(url);
  const fb = twin ? await fetchBytes(twin) : null;
  if (!fb) return "";
  try {
    return await normalise(fb.bytes, width);
  } catch {
    return "";
  }
}

async function withArt(m: Mover): Promise<Mover> {
  return { ...m, imageUrl: await artDataUri(m.imageUrl) };
}

async function allowed(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secretEqual(presentedKey(req), secret)) return true;
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
  const kindParam = q.get("kind");
  const kind = (["card", "dips", "set", "games", ...ANGLE_KINDS] as const).find((k) => k === kindParam) ?? "movers";
  const game: GameId = parseGame(q.get("game"));
  const sizeKey = (["square", "story", "landscape"] as PostSize[]).find((s) => s === q.get("size")) ?? "square";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q.get("day") ?? "") ? (q.get("day") as string) : undefined;
  const size = POST_SIZES[sizeKey];
  const tall = sizeKey === "story";
  const wide = sizeKey === "landscape";
  const label = POST_GAME_NAMES[game];
  // Day plan (lib/socialPlan.ts): Pokémon pictures name the other games, and the movers picture can be a Pokémon + Magic mix.
  const plan = dayPlan(day);
  const alsoScans = plan.alsoScans && game === "pokemon" ? otherGameNames([game]) : undefined;

  if (kind === "games") {
    // From JUMPS_FROM each game's biggest weekly jump (a game with none keeps its lead card), the same list the caption names.
    const leads = jumpsOn(day ?? todayUtc()) ? await gameJumps(day) : await gameLeads(day);
    const drawn = await Promise.all(leads.map(async (l) => ({ ...l, imageUrl: await artDataUri(l.imageUrl, 540) })));
    // A blank card in a five-card picture reads as broken: fail, and the publisher's next ping retries.
    if (drawn.length < 3 || drawn.some((l) => !l.imageUrl)) return NextResponse.json({ error: "Game art missing" }, { status: 502 });
    return new ImageResponse(<AllGames leads={drawn} tall={tall} wide={wide} />, size);
  }
  if (kind === "card") {
    const card = await cardOfTheDay(game, day);
    if (!card) return NextResponse.json({ error: "No card today" }, { status: 404 });
    return new ImageResponse(<CardOfTheDay card={await withArt(card)} label={label} tall={tall} wide={wide} />, size);
  }
  if (kind === "set") {
    const spot = await setSpotlight(game, day);
    if (!spot) return NextResponse.json({ error: "No set today" }, { status: 404 });
    return new ImageResponse(
      <Movers movers={await Promise.all(spot.cards.map(withArt))} label={label} tall={tall} wide={wide} heading={spot.setName} mode="price" alsoScans={alsoScans} leadId={spot.leadId} />,
      size,
    );
  }
  if (isAngleKind(kind)) {
    // The five angles (10-03): the same data the draft was written from (angleData: the day's game rotation, or the next game with data).
    const a = await withSeriesCache(() => angleData(kind, day ?? todayUtc()));
    if (!a) return NextResponse.json({ error: "Nothing for this angle today" }, { status: 404 });
    const cards = await Promise.all(a.cards.map(withArt));
    if (cards.some((c) => !c.imageUrl)) return NextResponse.json({ error: "Card art missing" }, { status: 502 });
    const name = POST_GAME_NAMES[a.game];
    if (kind === "versus") return new ImageResponse(<Versus pair={{ ...(a.pair as Pair), a: cards[0], b: cards[1] }} label={name} tall={tall} wide={wide} />, size);
    if (kind === "thennow") return new ImageResponse(<CardOfTheDay card={cards[0]} label={name} tall={tall} wide={wide} kicker={`${name} · then vs now`} then />, size);
    if (kind === "guess" && !a.mixed) return new ImageResponse(<CardOfTheDay card={cards[0]} label={name} tall={tall} wide={wide} kicker={`${name} · what's it worth?`} />, size);
    if (kind === "guess") return new ImageResponse(<Movers movers={cards} label="" tall={tall} wide={wide} heading="What's it worth?" mode="price" sub="One card from each game, market price today" showSet />, size);
    if (kind === "top") {
      return new ImageResponse(
        <Movers movers={cards} label={a.mixed ? "" : name} tall={tall} wide={wide} heading={a.mixed ? "Most valuable card in each game" : "Most valuable right now"} mode="price" sub={a.mixed ? "One card per game, market price today" : `Five of the most valuable cards · ${name} market price today`} showSet />,
        size,
      );
    }
    const games = [...new Set(cards.map((m) => m.game))].filter((g): g is GameId => Boolean(g));
    return new ImageResponse(<Movers movers={cards} label={a.mixed ? "" : name} tall={tall} wide={wide} heading={a.mixed ? `${listNames(games.map((g) => POST_GAME_NAMES[g]))} sleepers under $5` : "sleepers under $5"} />, size);
  }
  const frozen = day && (kind === "movers" || kind === "dips") ? await frozenMovers(game, kind, day) : null;
  if (kind === "movers" && plan.mixedMovers && game === "pokemon") {
    const movers = frozen ?? (await mixedMovers(day));
    if (movers.length === 0) return NextResponse.json({ error: "No movers" }, { status: 404 });
    const games = [...new Set(movers.map((m) => m.game ?? game))];
    return new ImageResponse(
      <Movers movers={await Promise.all(movers.map(withArt))} label="" tall={tall} wide={wide} heading={`${listNames(games.map((g) => POST_GAME_NAMES[g]))} price gains this week`} />,
      size,
    );
  }
  const featuredKind = kind === "dips" ? "dips" : "movers";
  const movers = frozen ?? (await topMovers(game, day, { direction: kind === "dips" ? "down" : "up", exclude: await recentlyFeatured(game, featuredKind, day) }));
  if (movers.length === 0) return NextResponse.json({ error: "No movers" }, { status: 404 });
  return new ImageResponse(
    <Movers movers={await Promise.all(movers.map(withArt))} label={label} tall={tall} wide={wide} heading={kind === "dips" ? "price drops this week" : "price gains this week"} alsoScans={alsoScans} />,
    size,
  );
}

/** "Also scans" + one pill per game the post does not cover (day plan alsoScans). */
function AlsoScans({ games, wide }: { games: string[]; wide: boolean }) {
  const fs = wide ? 20 : 28;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: wide ? 8 : 12, marginBottom: wide ? 8 : 16 }}>
      <div style={{ display: "flex", fontSize: fs, color: MUTED, marginRight: 4 }}>Also scans</div>
      {games.map((g) => (
        <div
          key={g}
          style={{
            display: "flex",
            fontSize: fs,
            padding: wide ? "4px 14px" : "6px 18px",
            borderRadius: 9999,
            background: "rgba(99,102,241,0.18)",
            border: "1px solid rgba(165,180,252,0.45)",
            color: "#e0e7ff",
          }}
        >
          {g}
        </div>
      ))}
    </div>
  );
}

function Frame({ children, tall, wide, alsoScans }: { children: React.ReactNode; tall: boolean; wide: boolean; alsoScans?: string[] }) {
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
      <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, marginTop: "auto", paddingTop: 16 }}>
        {alsoScans?.length ? <AlsoScans games={alsoScans} wide={wide} /> : null}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", width: 22, height: 22, borderRadius: 9999, background: "#6366f1" }} />
          <div style={{ display: "flex", fontSize: wide ? 30 : 40, fontWeight: 600 }}>CardFlip</div>
          <div style={{ display: "flex", fontSize: wide ? 24 : 30, color: MUTED, marginLeft: 8 }}>
            Scan a card, see what it&apos;s worth. cardflip.io
          </div>
        </div>
      </div>
    </div>
  );
}

function Pct({ pct, size }: { pct: number; size: number }) {
  const flat = Math.abs(pct) < 1;
  return (
    <div style={{ display: "flex", fontSize: size, fontWeight: 700, color: flat ? MUTED : pct > 0 ? UP : DOWN }}>
      {flat ? "steady" : pctLabel(pct)}
    </div>
  );
}

/** mode "move" = from → to with the % (movers, dips); "price" = today's price with the week's % as a footnote (set spotlight). */
function Movers({ movers, label, tall, wide, heading, mode = "move", alsoScans, leadId, sub, showSet }: { movers: Mover[]; label: string; tall: boolean; wide: boolean; heading: string; mode?: "move" | "price"; alsoScans?: string[]; leadId?: string; sub?: string; showSet?: boolean }) {
  const rows = wide ? movers.slice(0, 3) : movers;
  // Six rows (a mixed list) or the "Also scans" pills: smaller art so the footer stays on the picture.
  const tight = rows.length > 5 || Boolean(alsoScans?.length);
  // Three rows (sleepers under $5): bigger art and type, so the picture is full, not a list with a hole under it.
  const few = rows.length <= 3 && !wide;
  const art = wide ? 92 : few ? (tall ? 340 : 196) : tall ? 200 : rows.length > 5 ? 96 : tight ? 108 : 126;
  const fs = wide ? 24 : few ? (tall ? 50 : 34) : tall ? 38 : 28;
  const price = mode === "price";
  const headline = price || !label ? heading : `${label} ${heading}`;
  return (
    <Frame tall={tall} wide={wide} alsoScans={alsoScans}>
      {/* One line, always: a long set name ("Mysterious Treasures") shrinks instead of wrapping and pushing the footer off the picture. */}
      <div style={{ display: "flex", flexShrink: 0, fontSize: (wide ? 38 : tall ? 64 : 50) * (heading.length > 26 ? 0.72 : heading.length > 20 ? 0.86 : 1), fontWeight: 700, letterSpacing: -1, whiteSpace: "nowrap" }}>
        {headline}
      </div>
      <div style={{ display: "flex", flexShrink: 0, fontSize: wide ? 20 : 26, color: MUTED, marginTop: 4 }}>
        {sub ?? (price ? `Five of the most valuable cards · ${label} market price today` : "Market price, last 7 days, from CardFlip's price history")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, gap: wide ? 8 : few ? (tall ? 40 : 16) : tall ? 26 : tight ? 10 : 12, marginTop: wide ? 14 : few ? (tall ? 60 : 22) : tall ? 40 : tight ? 18 : 24 }}>
        {rows.map((m) => (
          <div
            key={m.cardId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: few ? 32 : 24,
              padding: wide ? 6 : few ? (tall ? 18 : 12) : tall ? 14 : 10,
              paddingLeft: wide ? 6 : 14,
              paddingRight: wide ? 16 : 24,
              borderRadius: 18,
              // The set's biggest riser leads and is marked: a green edge, so the first row reads as the hero.
              background: m.cardId === leadId ? "rgba(74,222,128,0.10)" : "rgba(170,180,255,0.07)",
              border: m.cardId === leadId ? "2px solid rgba(74,222,128,0.6)" : "1px solid rgba(255,255,255,0.11)",
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
                {price
                  ? `${m.game ? `${POST_GAME_NAMES[m.game]} · ` : ""}${showSet ? `${m.setName} · ` : ""}#${m.number}${variantLabel(m.variant) ? ` · ${variantLabel(m.variant)}` : ""}`
                  : `${m.game ? `${POST_GAME_NAMES[m.game]} · ` : ""}${m.setName} · ${m.number}`}
              </div>
              {price ? (
                m.unsettled ? null : (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: fs * 0.8, marginTop: 4, color: MUTED }}>
                    <Pct pct={m.pct} size={fs * 0.8} />
                    <div style={{ display: "flex" }}>this week</div>
                  </div>
                )
              ) : (
                <div style={{ display: "flex", fontSize: fs * 0.85, marginTop: 4 }}>
                  {money(m.from)} → {money(m.to)}
                </div>
              )}
            </div>
            {price ? <div style={{ display: "flex", fontSize: fs * 1.3, fontWeight: 700 }}>{money(m.to)}</div> : <Pct pct={m.pct} size={fs * 1.3} />}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/**
 * One card, large. `kicker` replaces "{label} card of the day" (guess the
 * price, then vs now); `then` draws the old price struck through above
 * today's and the move "since May" (then vs now, the card's `from`/`thenDay`).
 */
function CardOfTheDay({ card, label, tall, wide, kicker, then }: { card: Mover; label: string; tall: boolean; wide: boolean; kicker?: string; then?: boolean }) {
  const artH = wide ? 440 : tall ? 900 : 620;
  const foot = then ? `since ${thenMonth(card)}` : card.unsettled ? "market price today" : "last 7 days";
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
            {kicker ?? `${label} card of the day`}
          </div>
          <div style={{ display: "flex", fontSize: wide ? 48 : 64, fontWeight: 700, marginTop: 12, letterSpacing: -1 }}>{card.name}</div>
          <div style={{ display: "flex", fontSize: wide ? 26 : 34, color: MUTED, marginTop: 6 }}>
            {card.setName} · {card.number}
          </div>
          {then ? (
            // The label is the size of its amount (Chris 10-03, the video first and now the picture: a 32px "May" beside a 60px amount "looks goofy").
            <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginTop: 24 }}>
              <div style={{ display: "flex", fontSize: wide ? 44 : 60, fontWeight: 600, color: "#a5b4fc", textTransform: "uppercase", letterSpacing: -0.5 }}>{thenMonth(card)}</div>
              <div style={{ display: "flex", fontSize: wide ? 44 : 60, fontWeight: 700, color: MUTED, textDecoration: "line-through" }}>{money(card.from)}</div>
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              fontSize: wide ? 88 : 120,
              fontWeight: 800,
              marginTop: then ? 4 : 24,
              backgroundImage: HOLO,
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            {money(card.to)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8 }}>
            {then || !card.unsettled ? <Pct pct={card.pct} size={wide ? 30 : 40} /> : null}
            <div style={{ display: "flex", fontSize: wide ? 24 : 30, color: MUTED }}>{foot}</div>
          </div>
        </div>
      </div>
    </Frame>
  );
}

/**
 * Every public game in one picture (day plan morning "games", Chris 09-30:
 * "we feature all game types in the static image"): one real priced card
 * per game (gameLeads = the homepage strip's picks), fanned edge to edge,
 * the middle card on top, each game's name and today's price underneath.
 */
function AllGames({ leads: given, tall, wide }: { leads: GameLead[]; tall: boolean; wide: boolean }) {
  // The biggest-jump post (10-01): the biggest mover sits in the middle of the fan, on top; each tile carries its green %.
  const jump = given.some(isJump);
  const leads = jump ? fanOrder(given) : given;
  const n = leads.length;
  // The fan spans the content width (canvas minus the frame's padding).
  const inner = wide ? 1200 - 88 : tall ? 1080 - 160 : 1080 - 128;
  const cardW = jump ? (wide ? 150 : tall ? 300 : 268) : wide ? 168 : tall ? 300 : 290;
  const cardH = Math.round(cardW / 0.716);
  const step = (inner - cardW) / Math.max(1, n - 1);
  const mid = (n - 1) / 2;
  // Outer cards first, the centre last, so the centre sits on top.
  const order = leads.map((_, i) => i).sort((a, b) => Math.abs(b - mid) - Math.abs(a - mid));
  // Label tiles: as wide as a fan step allows (~155px square), fixed height so every price sits on one line.
  const tileW = Math.min(step - 10, wide ? 220 : 190);
  const gameFs = wide ? 12 : 15;
  const nameFs = wide ? 17 : 21;
  const priceFs = wide ? 24 : 32;
  // Long names step down so they stay on two lines ("Exodia the Forbidden One" ran to three at 21px).
  const fitName = (name: string) => (name.length <= 14 ? nameFs : name.length <= 19 ? nameFs - 2 : nameFs - 4);
  const pctFs = priceFs * 0.95;
  const tileH = Math.round((wide ? 16 : 24) + gameFs * 1.2 + (wide ? 3 : 6) + nameFs * 1.15 * 2 + (wide ? 2 : 4) + priceFs * 1.2 + (jump ? pctFs * 1.15 : 0));
  return (
    <Frame tall={tall} wide={wide}>
      <div style={{ display: "flex", flexShrink: 0, fontSize: wide ? 44 : tall ? 84 : 72, fontWeight: 700, letterSpacing: -1.5, lineHeight: 1.04, flexDirection: wide ? "row" : "column" }}>
        <div style={{ display: "flex" }}>{jump ? (given.every(isJump) ? "Biggest price jump" : "Biggest price jumps") : "One scanner."}</div>
        <div style={{ display: "flex", marginLeft: wide ? 14 : 0, backgroundImage: HOLO, backgroundClip: "text", color: "transparent" }}>
          {jump ? (given.every(isJump) ? "in every game." : "this week.") : `${n === 5 ? "Five" : String(n)} card games.`}
        </div>
      </div>
      <div style={{ display: "flex", flexShrink: 0, fontSize: wide ? 20 : 28, color: MUTED, marginTop: wide ? 6 : 14 }}>
        {jump ? (given.every(isJump) ? "The top gainer in every game, market price today." : "Top gainers this week. A game with no big mover shows one card.") : "One card from each game, market price today."}
      </div>
      {/* Fan + names centred in the space left above the footer (no dead band under the names). */}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", paddingBottom: wide ? 0 : 24 }}>
      <div style={{ display: "flex", position: "relative", flexShrink: 0, width: inner, height: cardH + (wide ? 30 : 70) }}>
        {order.map((i) => {
          const off = i - mid;
          return (
            <div
              key={leads[i].game}
              style={{
                display: "flex",
                position: "absolute",
                left: i * step,
                top: Math.abs(off) * (wide ? 6 : 16) + (wide ? 6 : 24),
                width: cardW,
                height: cardH,
                transform: `rotate(${off * (wide ? 4 : 6)}deg)`,
                borderRadius: 14,
                boxShadow: "0 10px 40px rgba(0,0,0,0.65)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={leads[i].imageUrl} alt="" width={cardW} height={cardH} style={{ borderRadius: 14, objectFit: "cover" }} />
            </div>
          );
        })}
      </div>
      {/* One tile per card, centred under it (Chris 09-30: "i hate the size, labeling and grouping
          of the text below the card pictures"): the game as a small caps label, the card's name
          (two lines kept for every tile so the prices line up), then the price, large. */}
      <div style={{ display: "flex", position: "relative", flexShrink: 0, width: inner, height: tileH, marginTop: wide ? 8 : 22 }}>
        {leads.map((l, i) => (
          <div
            key={l.game}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              position: "absolute",
              top: 0,
              left: i * step + cardW / 2 - tileW / 2,
              width: tileW,
              height: tileH,
              padding: wide ? "8px 6px" : "12px 8px",
              borderRadius: 16,
              backgroundColor: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.10)",
            }}
          >
            <div style={{ display: "flex", fontSize: gameFs, fontWeight: 600, letterSpacing: 1.6, color: MUTED, whiteSpace: "nowrap" }}>{POST_GAME_NAMES[l.game].toUpperCase()}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: nameFs * 1.15 * 2, marginTop: wide ? 3 : 6, width: tileW - 12, overflow: "hidden", fontSize: fitName(l.name), fontWeight: 600, lineHeight: 1.15, textAlign: "center" }}>
              {/* "Monkey.D.Luffy" has no space to wrap on: let it break after the dots. */}
              {displayName(l.name).replace(/\./g, ".​")}
            </div>
            {jump ? (
              isJump(l) ? (
                <div style={{ display: "flex", fontSize: pctFs, fontWeight: 800, marginTop: wide ? 2 : 4, color: UP, whiteSpace: "nowrap" }}>{pctLabel(l.pct as number)}</div>
              ) : (
                <div style={{ display: "flex", fontSize: pctFs * 0.55, fontWeight: 600, marginTop: wide ? 2 : 4, height: pctFs * 1.15 - (wide ? 2 : 4) - 4, alignItems: "center", color: MUTED, whiteSpace: "nowrap" }}>market price</div>
              )
            ) : null}
            <div style={{ display: "flex", fontSize: priceFs, fontWeight: 700, marginTop: wide ? 2 : 4, backgroundImage: HOLO, backgroundClip: "text", color: "transparent", whiteSpace: "nowrap" }}>{money(l.price)}</div>
          </div>
        ))}
      </div>
      </div>
    </Frame>
  );
}

/**
 * Head to head (angle "versus", 10-03): two cards of one game side by side,
 * each with its price and its week (or "market price today" for a TCG game
 * with no history), the winner's tile edged green, the verdict underneath
 * in the caption's words (versusVerdict).
 */
function Versus({ pair, label, tall, wide }: { pair: Pair; label: string; tall: boolean; wide: boolean }) {
  // Art no wider than its tile: half the content width minus the gap and the tile's padding (story: (1080 − 160 − 32) / 2 − 40 ≈ 404px wide → 560 tall).
  // The square has 952px inside its padding: title + sub (95), the tiles' own ~310 of name, set, price, week and tag, the
  // verdict (54) and the footer (64) leave ~390 for the art. 440 pushed the footer off the picture (Chris 10-03).
  const artH = wide ? 300 : tall ? 560 : 370;
  const nameFs = wide ? 26 : tall ? 44 : 32;
  const priceFs = wide ? 44 : tall ? 80 : 56;
  const sides = [pair.a, pair.b];
  // The two tiles share one height (the row stretches them) and centre their own content, so a name that wraps on one
  // side never shifts the other; the set line wraps inside its tile instead of running under the neighbour.
  const meta = (m: Mover) => `${m.setName} · ${m.number}${variantLabel(m.variant) ? ` · ${variantLabel(m.variant)}` : ""}`;
  return (
    <Frame tall={tall} wide={wide}>
      <div style={{ display: "flex", flexShrink: 0, fontSize: wide ? 38 : tall ? 64 : 50, fontWeight: 700, letterSpacing: -1, whiteSpace: "nowrap" }}>
        {label} head to head
      </div>
      <div style={{ display: "flex", flexShrink: 0, fontSize: wide ? 20 : tall ? 30 : 26, color: MUTED, marginTop: 4 }}>
        {pair.byPrice ? "Which is worth more? Market price today" : `${pair.setName ? `${pair.setName} · ` : ""}Two cards, one week. Which one moved?`}
      </div>
      <div style={{ display: "flex", flexGrow: 1, alignItems: "stretch", justifyContent: "center", gap: wide ? 24 : 32, marginTop: wide ? 10 : 24, marginBottom: wide ? 0 : 12 }}>
        {sides.map((m, i) => {
          const win = pair.winner === i;
          return (
            <div
              key={m.cardId}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                flex: 1,
                minWidth: 0,
                padding: wide ? 12 : 20,
                borderRadius: 22,
                background: win ? "rgba(74,222,128,0.10)" : "rgba(170,180,255,0.07)",
                border: win ? "2px solid rgba(74,222,128,0.6)" : "1px solid rgba(255,255,255,0.11)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.imageUrl} alt="" width={artH * 0.716} height={artH} style={{ borderRadius: 14, objectFit: "cover", boxShadow: "0 10px 40px rgba(0,0,0,0.6)" }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: nameFs * 1.15 * 2, marginTop: wide ? 10 : 18, fontSize: m.name.length > 22 ? nameFs * 0.85 : nameFs, fontWeight: 600, lineHeight: 1.15, textAlign: "center" }}>{m.name}</div>
              <div style={{ display: "flex", justifyContent: "center", fontSize: nameFs * (meta(m).length > 30 ? 0.56 : 0.68), color: MUTED, marginTop: 4, textAlign: "center", lineHeight: 1.2 }}>{meta(m)}</div>
              <div style={{ display: "flex", fontSize: priceFs, fontWeight: 800, marginTop: wide ? 6 : 12, backgroundImage: HOLO, backgroundClip: "text", color: "transparent" }}>{money(m.to)}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                {pair.byPrice ? (
                  <div style={{ display: "flex", fontSize: nameFs * 0.7, color: MUTED }}>market price today</div>
                ) : (
                  <>
                    <Pct pct={m.pct} size={nameFs * 0.9} />
                    <div style={{ display: "flex", fontSize: nameFs * 0.7, color: MUTED }}>this week</div>
                  </>
                )}
              </div>
              {win ? (
                <div style={{ display: "flex", marginTop: wide ? 8 : 14, fontSize: nameFs * 0.6, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: UP, padding: "4px 14px", borderRadius: 9999, border: "1px solid rgba(74,222,128,0.5)" }}>
                  {pair.byPrice ? "worth more" : "winner"}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", flexShrink: 0, fontSize: wide ? 22 : tall ? 34 : 28, color: "#e4e4e7", marginTop: wide ? 10 : 20, textAlign: "center", justifyContent: "center" }}>{versusVerdict(pair)}</div>
    </Frame>
  );
}
