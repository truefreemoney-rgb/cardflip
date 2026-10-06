import "server-only";

/**
 * The two share pictures (audit G2), 1080x1920 so TikTok, Reddit and Stories take them as they are.
 * Drawn with next/og on the same dark frame as the social posts (docs/DESIGN.md): one indigo glow,
 * the holo gradient on the one number that matters. The art helper and fonts are the social pictures' own.
 *   card:       one catalog card, its market price (no user data)
 *   collection: the signed-in user's own total, copy count and top three
 */

export const SHARE_SIZE = { width: 1080, height: 1920 } as const;

const BG = "#0a0b11";
const MUTED = "#a1a1aa";
const HOLO = "linear-gradient(90deg, #7dd3fc, #a78bfa, #f0abfc, #fcd34d)";

export function shareMoney(n: number): string {
  return n >= 100 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`;
}

function Frame({ children }: { children: React.ReactNode }) {
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
        padding: 80,
        fontFamily: "Geist, sans-serif",
      }}
    >
      {children}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginTop: "auto", paddingTop: 24 }}>
        <div style={{ display: "flex", width: 24, height: 24, borderRadius: 9999, background: "#6366f1" }} />
        <div style={{ display: "flex", fontSize: 38, color: MUTED }}>Scanned with CardFlip · cardflip.io</div>
      </div>
    </div>
  );
}

function Holo({ children, size }: { children: string; size: number }) {
  return (
    <div style={{ display: "flex", fontSize: size, fontWeight: 800, backgroundImage: HOLO, backgroundClip: "text", color: "transparent" }}>{children}</div>
  );
}

function Art({ src, w, h }: { src: string; w: number; h: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={w} height={h} style={{ borderRadius: 24, objectFit: "cover" }} />
  ) : (
    <div style={{ display: "flex", width: w, height: h, borderRadius: 24, background: "#1c1d27" }} />
  );
}

export function CardShare({ name, setName, game, image, price }: { name: string; setName: string; game: string; image: string; price: number | null }) {
  return (
    <Frame>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", flex: 1 }}>
        <div style={{ display: "flex", fontSize: 32, color: MUTED, textTransform: "uppercase", letterSpacing: 4 }}>{game}</div>
        <div style={{ display: "flex", marginTop: 40, boxShadow: "0 0 100px rgba(99,102,241,0.4)", borderRadius: 24 }}>
          <Art src={image} w={640} h={894} />
        </div>
        <div style={{ display: "flex", fontSize: name.length > 28 ? 56 : 72, fontWeight: 700, marginTop: 48, letterSpacing: -1 }}>{name}</div>
        <div style={{ display: "flex", fontSize: 36, color: MUTED, marginTop: 10 }}>{setName}</div>
        {price != null && price > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 36 }}>
            <Holo size={150}>{shareMoney(price)}</Holo>
            <div style={{ display: "flex", fontSize: 32, color: MUTED, marginTop: 2 }}>Market price today</div>
          </div>
        ) : null}
      </div>
    </Frame>
  );
}

export interface ShareTop {
  name: string;
  setName: string;
  image: string;
  value: number;
}

export function CollectionShare({ game, total, copies, top }: { game: string; total: number; copies: number; top: ShareTop[] }) {
  return (
    <Frame>
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ display: "flex", fontSize: 34, color: MUTED, textTransform: "uppercase", letterSpacing: 4 }}>{game} collection value</div>
        <div style={{ display: "flex", marginTop: 20 }}>
          <Holo size={190}>{shareMoney(total)}</Holo>
        </div>
        <div style={{ display: "flex", fontSize: 40, color: MUTED, marginTop: 4 }}>
          {copies} {copies === 1 ? "card" : "cards"}
        </div>
        {top.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 64 }}>
            <div style={{ display: "flex", fontSize: 32, color: MUTED, textTransform: "uppercase", letterSpacing: 4 }}>Most valuable</div>
            {top.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 36, marginTop: 28 }}>
                <Art src={c.image} w={200} h={279} />
                <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                  <div style={{ display: "flex", fontSize: 46, fontWeight: 700, lineHeight: 1.15 }}>{c.name.length > 34 ? `${c.name.slice(0, 33)}…` : c.name}</div>
                  <div style={{ display: "flex", fontSize: 30, color: MUTED, marginTop: 6 }}>{c.setName}</div>
                </div>
                <div style={{ display: "flex", fontSize: 54, fontWeight: 800 }}>{shareMoney(c.value)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Frame>
  );
}
