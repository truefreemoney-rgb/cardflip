import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { api } from "~/lib/api";
import { colors } from "~/lib/theme";

/**
 * The website's price history chart (components/PriceHistoryChart.tsx) in the
 * app's own pieces: one USD series from /api/price-history, the last 90 days,
 * an area under a line, low and high of the window on the right. Draws nothing
 * when the card has no USD history (no empty box).
 */

interface Point {
  day: string;
  price: number;
}
interface Series {
  variant: string;
  source: string;
  currency: string;
  points: Point[];
  stats?: { change30?: number | null };
}

const DAYS = 90;
const W = 320;
const H = 104;
const PAD = { top: 10, bottom: 18, left: 6, right: 48 };
const HEAD = 30; // the title row above the svg

export default function PriceChart({ cardId, variant, width = W }: { cardId: string; variant: string | null; width?: number }) {
  const [series, setSeries] = useState<Series | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    api<{ series: Series[] }>(`/api/price-history?cardId=${encodeURIComponent(cardId)}`)
      .then((res) => {
        if (!live) return;
        const usd = res.series.filter((s) => s.currency === "USD" && s.points.length > 1);
        setSeries(usd.find((s) => s.variant === variant) ?? usd[0] ?? null);
      })
      .catch(() => live && setSeries(null));
    return () => {
      live = false;
    };
  }, [cardId, variant]);

  if (!series) return null;

  const points = lastDays(series.points);
  if (points.length < 2) return null;

  const lo = Math.min(...points.map((p) => p.price));
  const hi = Math.max(...points.map((p) => p.price));
  const span = hi - lo || hi || 1;
  const iw = width - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * iw;
  const y = (v: number) => PAD.top + (1 - (v - lo) / span) * ih;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.price).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${(PAD.top + ih).toFixed(1)} L${PAD.left} ${(PAD.top + ih).toFixed(1)} Z`;
  const change = series.stats?.change30;
  // One colour for the line and the 30-day figure: the 30-day change when the server has it, else first vs last of the window.
  const up = typeof change === "number" ? change >= 0 : points[points.length - 1].price >= points[0].price;
  const stroke = up ? colors.money : "#f87171";

  return (
    <View style={[styles.box, { width }]}>
      <View style={styles.head}>
        <Text style={styles.title}>Last {DAYS} days</Text>
        {typeof change === "number" ? (
          <Text style={[styles.change, { color: stroke }]}>
            {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(0)}% in 30 days
          </Text>
        ) : null}
      </View>
      <Svg width={width} height={H}>
        <Defs>
          <LinearGradient id="pc-fill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={stroke} stopOpacity="0.35" />
            <Stop offset="1" stopColor={stroke} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Path d={area} fill="url(#pc-fill)" />
        <Path d={line} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
      <Text style={[styles.tick, { top: HEAD + PAD.top - 6 }]}>${hi.toFixed(2)}</Text>
      <Text style={[styles.tick, { top: HEAD + PAD.top + ih - 22 }]}>${lo.toFixed(2)}</Text>
      <View style={styles.axis}>
        <Text style={styles.axisText}>{label(points[0].day)}</Text>
        <Text style={styles.axisText}>{label(points[points.length - 1].day)}</Text>
      </View>
    </View>
  );
}

/** The window's points, cut by the last day in the series (not the clock, so the render stays pure). */
function lastDays(all: Point[]): Point[] {
  const end = new Date(`${all[all.length - 1].day}T00:00:00Z`).getTime();
  const since = new Date(end - DAYS * 86400e3).toISOString().slice(0, 10);
  return all.filter((p) => p.day >= since);
}

function label(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const styles = StyleSheet.create({
  box: { alignSelf: "center", backgroundColor: colors.surface1, borderColor: colors.edge, borderWidth: 1, borderRadius: 14, paddingBottom: 6 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 10 },
  title: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  change: { fontSize: 12, fontWeight: "700" },
  tick: { position: "absolute", right: 10, color: colors.faint, fontSize: 11, fontVariant: ["tabular-nums"] },
  axis: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, marginTop: -14 },
  axisText: { color: colors.faint, fontSize: 11 },
});
