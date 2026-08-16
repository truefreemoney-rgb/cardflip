/**
 * The app icon, drawn with Satori-safe JSX so `app/icon.tsx` and
 * `app/apple-icon.tsx` render it to PNG at build time (same pipeline as the
 * OG image). Kept here so both sizes are one drawing.
 *
 * Design: a tilted card with a brand-indigo face and a holo-sky corner
 * glint, on the site's near-black — reads as "trading card" at 48px and
 * survives maskable cropping (everything important sits inside the central
 * 80% safe zone).
 */
export function BrandIcon({ size }: { size: number }) {
  const pad = size * 0.16;
  const cardW = size - pad * 2;
  const cardH = cardW * 1.28;
  const radius = size * 0.09;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#08090d",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          width: cardW,
          height: cardH,
          borderRadius: radius,
          background: "linear-gradient(160deg, #818cf8 0%, #6366f1 45%, #4f46e5 100%)",
          transform: "rotate(-9deg) translateY(4%)",
          boxShadow: `0 ${size * 0.04}px ${size * 0.12}px rgba(0,0,0,0.6)`,
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            position: "absolute",
            top: cardH * 0.10,
            left: cardW * 0.12,
            width: cardW * 0.76,
            height: cardH * 0.34,
            borderRadius: radius * 0.5,
            background: "linear-gradient(120deg, #7dd3fc 0%, #a78bfa 55%, #f0abfc 100%)",
            opacity: 0.9,
          }}
        />
        <div
          style={{
            display: "flex",
            position: "absolute",
            bottom: cardH * 0.12,
            left: cardW * 0.12,
            width: cardW * 0.5,
            height: cardH * 0.06,
            borderRadius: 9999,
            background: "rgba(255,255,255,0.85)",
          }}
        />
        <div
          style={{
            display: "flex",
            position: "absolute",
            bottom: cardH * 0.24,
            left: cardW * 0.12,
            width: cardW * 0.32,
            height: cardH * 0.06,
            borderRadius: 9999,
            background: "rgba(255,255,255,0.55)",
          }}
        />
      </div>
    </div>
  );
}
