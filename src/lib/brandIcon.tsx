/**
 * The app icon, rendered by `app/icon.tsx` and `app/apple-icon.tsx` to PNG at
 * build time. It IS the header logo (components/Logo.tsx SpinCycleMark) —
 * same SVG markup, passed to Satori as a data-URI <img> since Satori doesn't
 * draw SVG paths natively — on the site's near-black, scaled to keep the
 * arrows inside Android's maskable safe zone (central 80%).
 *
 * If the header mark changes, change SPIN_CYCLE_SVG to match.
 */
const SPIN_CYCLE_SVG = `<svg viewBox="10 8 100 100" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cf-spin-a" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7dd3fc"/>
      <stop offset="1" stop-color="#a78bfa"/>
    </linearGradient>
    <linearGradient id="cf-spin-b" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0" stop-color="#f0abfc"/>
      <stop offset="1" stop-color="#6366f1"/>
    </linearGradient>
  </defs>
  <g transform="rotate(-12 60 60)">
    <rect x="42" y="30" width="36" height="60" rx="6" fill="#1c1c28" stroke="#ffffff" stroke-width="6"/>
    <rect x="49" y="38" width="22" height="16" rx="3" fill="#fcd34d"/>
  </g>
  <path d="M 96 40 A 42 42 0 0 0 34 26" fill="none" stroke="url(#cf-spin-a)" stroke-width="8" stroke-linecap="round"/>
  <path d="M 34 26 l 12 -6 M 34 26 l 13 5" stroke="#7dd3fc" stroke-width="8" stroke-linecap="round"/>
  <path d="M 24 80 A 42 42 0 0 0 86 94" fill="none" stroke="url(#cf-spin-b)" stroke-width="8" stroke-linecap="round"/>
  <path d="M 86 94 l -12 6 M 86 94 l -13 -5" stroke="#f0abfc" stroke-width="8" stroke-linecap="round"/>
</svg>`;

const SPIN_CYCLE_DATA_URI = `data:image/svg+xml,${encodeURIComponent(SPIN_CYCLE_SVG)}`;

export function BrandIcon({ size, transparent = false }: { size: number; transparent?: boolean }) {
  // Favicon: transparent, mark fills the frame (a dark square reads as a blob
  // on the tab strip, and at 16px the mark needs every pixel). Apple icon
  // keeps the solid ground — iOS composites transparency onto black.
  const mark = transparent ? size : Math.round(size * 0.8);
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: transparent ? "transparent" : "#08090d",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={SPIN_CYCLE_DATA_URI} alt="" width={mark} height={mark} />
    </div>
  );
}
