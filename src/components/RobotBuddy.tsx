"use client";

import { useId } from "react";

/**
 * The CardFlip robot — "floating core" (Chris picked it 09-04): a hovering
 * head with a foil ring and two little floating hands, no body. Tutorial
 * guide today, nav companion next. Poses move the hands, tilt the head and
 * change the eyes; nothing else, so it stays one recognisable shape.
 *
 * The bob (`.bot-float`) and blink (`.bot-eyes`) are CSS animations that
 * die under reduced motion — a still robot is fine; both rest in a neutral
 * frame so a frozen one doesn't look broken.
 */

export type RobotPose =
  | "idle"
  | "wave"
  | "point-up"
  | "point-down"
  | "point-left"
  | "point-right"
  | "think"
  | "celebrate"
  | "shrug"
  | "sleep";

const BODY = "#5b57e8";
const HAND = "#4b47d6";
const FACE = "#0e1020";
const EYE = "#7dd3fc";

interface Pose {
  tilt: number;
  /** Head lift in viewBox units (negative = up). */
  lift: number;
  left: [number, number];
  right: [number, number];
  /** A pointing hand grows a short finger toward its target. */
  finger?: "up" | "down" | "left" | "right";
  eyes: "open" | "happy" | "closed" | "squint" | "wide";
  sparks?: boolean;
}

const POSES: Record<RobotPose, Pose> = {
  idle: { tilt: 0, lift: 0, left: [4, 44], right: [60, 44], eyes: "open" },
  wave: { tilt: -6, lift: -1, left: [4, 44], right: [62, 8], eyes: "happy" },
  "point-up": { tilt: -6, lift: -1, left: [4, 44], right: [62, 4], finger: "up", eyes: "open" },
  "point-down": { tilt: 6, lift: 1, left: [4, 44], right: [58, 62], finger: "down", eyes: "open" },
  "point-left": { tilt: -4, lift: 0, left: [-8, 34], right: [60, 44], finger: "left", eyes: "open" },
  "point-right": { tilt: 4, lift: 0, left: [4, 44], right: [72, 34], finger: "right", eyes: "open" },
  think: { tilt: 6, lift: 0, left: [4, 44], right: [52, 50], eyes: "squint" },
  celebrate: { tilt: 0, lift: -3, left: [2, 6], right: [62, 6], eyes: "happy", sparks: true },
  shrug: { tilt: 0, lift: 0, left: [-4, 30], right: [68, 30], eyes: "wide" },
  sleep: { tilt: 9, lift: 4, left: [6, 52], right: [58, 52], eyes: "closed" },
};

function Eyes({ kind, y }: { kind: Pose["eyes"]; y: number }) {
  switch (kind) {
    case "happy":
      return (
        <g stroke={EYE} strokeWidth="2.6" strokeLinecap="round" fill="none">
          <path d={`M20 ${y} q4 -5 8 0`} />
          <path d={`M36 ${y} q4 -5 8 0`} />
        </g>
      );
    case "closed":
      return (
        <g stroke={EYE} strokeWidth="2.6" strokeLinecap="round" fill="none">
          <path d={`M20 ${y} h8`} />
          <path d={`M36 ${y} h8`} />
        </g>
      );
    case "squint":
      return (
        <g fill={EYE}>
          <rect x="20" y={y - 2} width="8" height="4" rx="2" />
          <rect x="36" y={y - 4} width="8" height="6" rx="3" />
        </g>
      );
    case "wide":
      return (
        <g fill={EYE}>
          <circle cx="24" cy={y} r="4.6" />
          <circle cx="40" cy={y} r="4.6" />
        </g>
      );
    default:
      return (
        <g className="bot-eyes" fill={EYE} style={{ transformOrigin: `32px ${y}px` }}>
          <circle cx="24" cy={y} r="3.6" />
          <circle cx="40" cy={y} r="3.6" />
        </g>
      );
  }
}

function Hand({ at, finger }: { at: [number, number]; finger?: Pose["finger"] }) {
  const [x, y] = at;
  const tip =
    finger === "up" ? [x, y - 9] : finger === "down" ? [x, y + 9] : finger === "left" ? [x - 9, y] : finger === "right" ? [x + 9, y] : null;
  return (
    <g>
      {tip && <line x1={x} y1={y} x2={tip[0]} y2={tip[1]} stroke={HAND} strokeWidth="4" strokeLinecap="round" />}
      <circle cx={x} cy={y} r="5" fill={HAND} />
    </g>
  );
}

export default function RobotBuddy({
  pose = "idle",
  size = 64,
  className = "",
  float = true,
}: {
  pose?: RobotPose;
  size?: number;
  className?: string;
  /** The idle bob; off for the 28px nav version where it would just jitter. */
  float?: boolean;
}) {
  const p = POSES[pose];
  // One gradient id per instance: two robots on a page must not share one.
  const gid = `bot-foil-${useId().replace(/:/g, "")}`;
  const cy = 30 + p.lift;
  return (
    <svg viewBox="-10 -6 84 82" width={size} height={size} className={className} aria-hidden style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={gid} x1="0" x2="1">
          <stop offset="0" stopColor="#7dd3fc" />
          <stop offset="0.4" stopColor="#a78bfa" />
          <stop offset="0.7" stopColor="#f0abfc" />
          <stop offset="1" stopColor="#fcd34d" />
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="66" rx="16" ry="3" fill="#a78bfa" opacity="0.18" />
      <g className={float ? "bot-float" : undefined}>
        <g transform={`rotate(${p.tilt} 32 ${cy})`}>
          <circle cx="32" cy={cy} r="24" fill={BODY} />
          <circle cx="32" cy={cy} r="24" fill="none" stroke={`url(#${gid})`} strokeWidth="2.5" opacity={p.eyes === "closed" ? 0.5 : 0.9} />
          <rect x="15" y={cy - 10} width="34" height="20" rx="10" fill={FACE} />
          <Eyes kind={p.eyes} y={cy} />
        </g>
        <Hand at={p.left} finger={p.finger === "left" ? "left" : undefined} />
        <Hand at={p.right} finger={p.finger && p.finger !== "left" ? p.finger : undefined} />
        {p.sparks && (
          <g fill="#fcd34d">
            <circle cx="-4" cy="-2" r="1.6" />
            <circle cx="68" cy="-3" r="1.6" />
            <circle cx="32" cy="-4" r="1.6" />
          </g>
        )}
      </g>
    </svg>
  );
}
