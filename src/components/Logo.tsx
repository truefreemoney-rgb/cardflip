import Link from "next/link";

export default function Logo({ size = "md" }: { size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-7 w-7 text-xs" : "h-8 w-8 text-sm";
  const text = size === "sm" ? "text-sm" : "text-lg";

  return (
    <Link href="/" className="flex items-center gap-2">
      <span
        className={`flex ${box} items-center justify-center rounded-lg bg-[conic-gradient(from_140deg,#7dd3fc,#a78bfa,#f0abfc,#6366f1,#7dd3fc)] font-bold text-white shadow-sm shadow-brand-600/40`}
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
