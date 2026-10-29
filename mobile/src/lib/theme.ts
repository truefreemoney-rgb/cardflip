/**
 * The website's look (src/app/globals.css) carried into the app: dark
 * background with a brand glow at the top, indigo brand, holo hairlines,
 * money in green, Bricolage Grotesque for headlines (Chris 10-28: "mirror the
 * website as much as possible"). Keep these in step with the site; nothing
 * else in the app hard-codes a colour.
 */
export const colors = {
  background: "#0a0b11",
  surface: "#0b0d13",
  surfaceRaised: "#14161f",
  /** The site's bg-surface-1 panels (rgba(175,185,255,0.07)). */
  surface1: "rgba(175,185,255,0.07)",
  foilFill: "#0c0e14",
  tabBar: "#0d0e15",
  foreground: "#ededf2",
  muted: "#a1a1aa", // zinc-400
  faint: "#82828c", // the site's zinc-500 as rendered on the dark ground (audit 10-29)
  /** Placeholder text in fields (the site's placeholder:text-zinc-600 as rendered). */
  placeholder: "#6b6b75",
  edge: "rgba(255,255,255,0.14)",
  edgeStrong: "rgba(255,255,255,0.24)",
  brand: "#6366f1", // brand-500, every primary button
  brandHover: "#4f46e5",
  brandSoft: "#818cf8", // brand-400
  brand300: "#a5b4fc",
  brand200: "#c7d2fe",
  holoViolet: "#a78bfa",
  money: "#34d399", // emerald-400: prices, always $X.XX
  amber: "#fcd34d",
  /** The torch button when on (the site's amber-400). */
  torch: "#fbbf24",
  danger: "#f87171",
  ebay: "#0284c7",
  white: "#ffffff",
} as const;

/** The site's gradients: .bg-brand-500 buttons, .foil-edge hairlines, the body's top glow. */
export const gradients = {
  brand: ["#6d6af9", "#9d5cf0"] as const,
  /** The same button while pressed: the site lightens on hover/active. */
  brandPressed: ["#7e7bfa", "#ad6ef4"] as const,
  foil: ["rgba(125,211,252,0.85)", "rgba(167,139,250,0.8)", "rgba(255,255,255,0.18)", "rgba(240,171,252,0.75)", "rgba(252,211,77,0.6)"] as const,
  glow: ["rgba(99,102,241,0.22)", "rgba(14,16,32,0.6)", "rgba(10,11,17,0)"] as const,
  hairline: ["rgba(167,139,250,0)", "rgba(167,139,250,0.25)", "rgba(167,139,250,0)"] as const,
};

/** The site's --font-display (Bricolage Grotesque), loaded in app/_layout.tsx. Set fontFamily only, never fontWeight beside it. */
export const fonts = {
  display: "BricolageGrotesque_700Bold",
  displaySemi: "BricolageGrotesque_600SemiBold",
} as const;

export const radius = { sm: 8, md: 10, lg: 14, xl: 20 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
