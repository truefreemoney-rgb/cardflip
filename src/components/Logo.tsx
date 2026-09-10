import Image from "next/image";
import Link from "next/link";
import logo from "../../public/brand/cardflip-logo.png";

/**
 * The CardFlip logo (Chris's artwork, 09-09): the tilted CF card mark with
 * the CARDFLIP wordmark baked in, so no text sits beside it. One trimmed
 * 128px-tall PNG (transparent, white CARD — the site is dark everywhere it
 * appears) rendered at 28px in the app header and 32px on the standalone
 * pages; the browser scales it down, so it stays sharp on 2x–4x phones.
 *
 * Replaced the inline "Spin Cycle" SVG mark + "CardFlip" text. The favicon
 * and app icon (app/icon.tsx, app/apple-icon.tsx) are unchanged.
 */
export default function Logo({ size = "md", href = "/" }: { size?: "sm" | "md"; href?: string }) {
  const box = size === "sm" ? "h-7" : "h-8";
  return (
    <Link href={href} aria-label="CardFlip" className="flex items-center">
      <Image src={logo} alt="CardFlip" priority className={`${box} w-auto`} />
    </Link>
  );
}
