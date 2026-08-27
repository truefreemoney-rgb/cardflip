import Link from "next/link";

/**
 * The Spin Cycle mark (direction D from the 08-27 logo exploration —
 * Chris's pick): a tilted card spun by two holo-gradient arrows, the
 * scan → price → list → sold loop drawn as one glyph. Inline SVG so it
 * ships with zero assets and recolors with the palette; replaces the
 * old conic-gradient tile with the ⚡ emoji.
 *
 * The gradient ids are fixed: if two Logos render on one page the
 * browser resolves both against the first instance's defs, which are
 * identical — harmless by construction.
 */
function SpinCycleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id="cf-spin-a" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7dd3fc" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
        <linearGradient id="cf-spin-b" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#f0abfc" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <g transform="rotate(-12 60 60)">
        <rect x="42" y="30" width="36" height="60" rx="6" fill="#1c1c28" stroke="#ffffff" strokeWidth="6" />
        <rect x="49" y="38" width="22" height="16" rx="3" fill="#fcd34d" />
      </g>
      <path d="M 96 40 A 42 42 0 0 0 34 26" fill="none" stroke="url(#cf-spin-a)" strokeWidth="8" strokeLinecap="round" />
      <path d="M 34 26 l 12 -6 M 34 26 l 13 5" stroke="#7dd3fc" strokeWidth="8" strokeLinecap="round" />
      <path d="M 24 80 A 42 42 0 0 0 86 94" fill="none" stroke="url(#cf-spin-b)" strokeWidth="8" strokeLinecap="round" />
      <path d="M 86 94 l -12 6 M 86 94 l -13 -5" stroke="#f0abfc" strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
}

export default function Logo({ size = "md" }: { size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-7 w-7" : "h-8 w-8";
  const text = size === "sm" ? "text-sm" : "text-lg";

  return (
    <Link href="/" className="flex items-center gap-2">
      <SpinCycleMark className={box} />
      <span className={`${text} font-semibold tracking-tight text-white`}>
        CardFlip
      </span>
    </Link>
  );
}
