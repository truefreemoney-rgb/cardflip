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
    background_color: "#0a0b11",
    theme_color: "#0a0b11",
    categories: ["shopping", "utilities"],
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Padded variant: launchers mask to the middle ~80%, and the edge-to-edge
      // /icon lost its corners on Android (mobile QA 09-06).
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
