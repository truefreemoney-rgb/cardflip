import { ImageResponse } from "next/og";
import { BrandIcon } from "@/lib/brandIcon";

/**
 * Android adaptive icon (manifest purpose "maskable"). Launchers crop these
 * to a circle/squircle covering the middle ~80%, so the mark sits inside a
 * safe margin on a solid ground; the plain /icon (mark to the edges,
 * transparent) lost its corners in the drawer (mobile QA 09-06).
 */
export const dynamic = "force-static";

const SIZE = 512;
const MARK = 336; // ~66%: inside the 80% safe circle with room for squircle corners

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: SIZE,
          height: SIZE,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#08090d",
        }}
      >
        <BrandIcon size={MARK} transparent />
      </div>
    ),
    { width: SIZE, height: SIZE },
  );
}
