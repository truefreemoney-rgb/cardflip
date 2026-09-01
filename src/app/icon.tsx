import { ImageResponse } from "next/og";
import { BrandIcon } from "@/lib/brandIcon";

/** 512px PNG at /icon — favicon for modern browsers and the PWA manifest icon. */
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<BrandIcon size={512} transparent />, size);
}
