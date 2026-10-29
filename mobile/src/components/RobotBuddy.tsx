import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Rect, Stop } from "react-native-svg";

const BODY = "#5b57e8";
const HAND = "#4b47d6";
const FACE = "#0e1020";
const EYE = "#7dd3fc";

/**
 * The CardFlip robot (src/components/RobotBuddy.tsx, "floating core", Chris
 * 09-04): a hovering head with a foil ring and two little floating hands. The
 * site's header Help button wears him at 26 px; this is his idle pose, still
 * (the site's nav version does not bob either).
 */
export default function RobotBuddy({ size = 26 }: { size?: number }) {
  const cy = 30;
  return (
    <Svg viewBox="-10 -6 84 82" width={size} height={size}>
      <Defs>
        <LinearGradient id="botFoil" x1="0" x2="1" y1="0" y2="0">
          <Stop offset="0" stopColor="#7dd3fc" />
          <Stop offset="0.4" stopColor="#a78bfa" />
          <Stop offset="0.7" stopColor="#f0abfc" />
          <Stop offset="1" stopColor="#fcd34d" />
        </LinearGradient>
      </Defs>
      <Ellipse cx="32" cy="66" rx="16" ry="3" fill="#a78bfa" opacity={0.18} />
      <G>
        <Circle cx="32" cy={cy} r="24" fill={BODY} />
        <Circle cx="32" cy={cy} r="24" fill="none" stroke="url(#botFoil)" strokeWidth="2.5" opacity={0.9} />
        <Rect x="15" y={cy - 10} width="34" height="20" rx="10" fill={FACE} />
        <G fill={EYE}>
          <Circle cx="24" cy={cy} r="3.6" />
          <Circle cx="40" cy={cy} r="3.6" />
        </G>
      </G>
      <Circle cx="4" cy="44" r="5" fill={HAND} />
      <Circle cx="60" cy="44" r="5" fill={HAND} />
    </Svg>
  );
}
