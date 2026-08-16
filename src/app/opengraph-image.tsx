import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "CardFlip — Scan. Price. List.";

/**
 * Link previews (Slack, iMessage, eBay's own internal tooling) render bare
 * without an OG image; a branded card makes a pasted URL look like a real
 * product instead of a placeholder site.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#09090b",
          color: "white",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              display: "flex",
              width: 28,
              height: 28,
              borderRadius: 9999,
              background: "#6366f1",
            }}
          />
          <div style={{ display: "flex", fontSize: 96, fontWeight: 600 }}>
            CardFlip
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 40,
            color: "#a1a1aa",
            marginTop: 24,
          }}
        >
          Scan. Price. List your Pokémon & Magic cards.
        </div>
      </div>
    ),
    size,
  );
}
