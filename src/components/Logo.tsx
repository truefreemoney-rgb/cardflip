import Link from "next/link";

export default function Logo({ size = "md" }: { size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-7 w-7 text-xs" : "h-8 w-8 text-sm";
  const text = size === "sm" ? "text-sm" : "text-lg";

  return (
    <Link href="/" className="flex items-center gap-2">
      <span
        className={`flex ${box} items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-violet-600 font-bold text-white shadow-sm shadow-brand-600/40`}
        aria-hidden
      >
        ⚡
      </span>
      <span className={`${text} font-semibold tracking-tight text-white`}>
        CardFlip
      </span>
    </Link>
  );
}
