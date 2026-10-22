/**
 * The "live" pulse dot beside a Live on eBay label (review 10-19 shared #23:
 * five hand-written copies drifted on size and colour). One ring that pings
 * only when motion is allowed; under prefers-reduced-motion the ring is
 * hidden instead of frozen mid-ping over the dot.
 */
export default function LiveDot({ size = "sm", color = "emerald", className = "" }: { size?: "sm" | "md"; color?: "emerald" | "sky"; className?: string }) {
  const box = size === "md" ? "h-2 w-2" : "h-1.5 w-1.5";
  const fill = color === "sky" ? "bg-sky-400" : "bg-emerald-400";
  return (
    <span aria-hidden className={`relative flex ${box} ${className}`}>
      <span className={`absolute inline-flex h-full w-full rounded-full ${fill} opacity-60 motion-safe:animate-ping motion-reduce:hidden`} />
      <span className={`relative inline-flex ${box} rounded-full ${fill}`} />
    </span>
  );
}
