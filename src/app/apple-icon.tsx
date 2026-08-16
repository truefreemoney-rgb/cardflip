import { ImageResponse } from "next/og";
import { BrandIcon } from "@/lib/brandIcon";

/** iOS home-screen icon (Safari ignores SVG/manifest icons; it wants this PNG). */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<BrandIcon size={180} />, size);
}
