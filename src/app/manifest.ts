import type { MetadataRoute } from "next";

/**
 * Installable web app. The scanner is phone-first — "Add to Home Screen"
 * gives it a full-screen camera view without Safari/Chrome chrome and a
 * real icon in the drawer. Served at /manifest.webmanifest and linked from
 * every page by Next automatically.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CardFlip — Scan. Price. List.",
    short_name: "CardFlip",
    description:
      "Scan Pokémon and Magic cards, get real market prices, and list them on eBay.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#08090d",
    theme_color: "#08090d",
    categories: ["shopping", "utilities"],
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
