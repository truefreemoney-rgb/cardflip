/**
 * The website's look (src/app/globals.css) carried into the app: dark
 * background, indigo brand, money in green. Keep these in step with the site;
 * nothing else in the app hard-codes a colour.
 */
export const colors = {
  background: "#0a0b11",
  surface: "#0b0d13",
  surfaceRaised: "#14161f",
  foreground: "#ededf2",
  muted: "#a1a1aa", // zinc-400
  faint: "#71717a", // zinc-500
  edge: "rgba(255,255,255,0.14)",
  edgeStrong: "rgba(255,255,255,0.24)",
  brand: "#6366f1", // brand-500, every primary button
  brandHover: "#4f46e5",
  brandSoft: "#818cf8",
  money: "#34d399", // emerald-400: prices, always $X.XX
  danger: "#f87171",
  white: "#ffffff",
} as const;

export const radius = { md: 10, lg: 14, xl: 20 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
