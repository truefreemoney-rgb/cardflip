import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GAMES, pictureUrl, type GameId } from "~/lib/catalog";
import { fetchInsights, formatMoney, type Insights, type Mover } from "~/lib/collection";
import { useAuth } from "~/lib/auth";
import { colors, fonts, radius, space } from "~/lib/theme";

/**
 * Insights (the website's /app/collection/insights): what the collection is
 * worth today vs a week and a month ago, the movers, listed vs sitting, the
 * most valuable cards and value by set. Same route, same numbers.
 */
export default function InsightsScreen() {
  const { game: gameParam } = useLocalSearchParams<{ game?: string }>();
  const game = (gameParam && gameParam in GAMES ? gameParam : "pokemon") as GameId;
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const pricingOnly = Boolean(user?.pricingOnly);
  const [data, setData] = useState<Insights | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    fetchInsights(game)
      .then((d) => live && setData(d))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [game]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.sm }]}>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(app)/cards"))} hitSlop={8} style={styles.backBtn}>
        <Text style={styles.back}>‹ My Cards</Text>
      </Pressable>
      <Text style={styles.h1}>Insights</Text>
      <Text style={styles.sub}>{GAMES[game].label}</Text>
      {data === undefined && <ActivityIndicator color={colors.brandSoft} style={{ marginTop: space.xl }} />}
      {data === null && <Text style={styles.empty}>{"Couldn't load your insights. Go back and try again."}</Text>}
      {data && (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.xl, paddingTop: space.md, gap: space.lg }}>
          <View style={styles.card}>
            <Text style={styles.label}>Worth today</Text>
            <Text style={styles.big}>{formatMoney(data.value.now)}</Text>
            <View style={{ flexDirection: "row", gap: space.lg, marginTop: 6 }}>
              <Delta label="vs last week" now={data.value.now} then={data.value.weekAgo} />
              <Delta label="vs last month" now={data.value.now} then={data.value.monthAgo} />
            </View>
            {data.leftOut > 0 && <Text style={styles.foot}>{data.leftOut} {data.leftOut === 1 ? "copy" : "copies"} left out: the market price looks off.</Text>}
          </View>

          <Section title="Movers this week">
            {data.gainers.length + data.losers.length === 0 ? (
              <Text style={styles.muted}>Nothing moved more than a few cents.</Text>
            ) : (
              [...data.gainers, ...data.losers].map((m) => <MoverRow key={`${m.id}-${m.delta}`} m={m} game={game} />)
            )}
          </Section>

          <Section title={pricingOnly ? "In stock vs sold" : "Listed vs sitting"}>
            {(
              [
                ["Live on eBay", data.split.live, colors.money],
                [pricingOnly ? "In Stock" : "Not Listed", data.split.draft, colors.brandSoft],
                ["Ended, unsold", data.split.ended, "#fcd34d"],
                ["Sold", data.split.sold, "#7dd3fc"],
              ] as const
            )
              .filter(([label, s]) => !pricingOnly || s.count > 0 || (label !== "Live on eBay" && label !== "Ended, unsold"))
              .map(([label, s, dot]) => (
                <View key={label} style={styles.splitRow}>
                  <View style={[styles.dot, { backgroundColor: dot }]} />
                  <Text style={styles.splitLabel}>{label}</Text>
                  <Text style={styles.muted}>{s.count}</Text>
                  <Text style={styles.money}>{formatMoney(s.value)}</Text>
                </View>
              ))}
          </Section>

          <Section title="Your most valuable">
            {data.top.length === 0 ? (
              <Text style={styles.muted}>No priced cards yet.</Text>
            ) : (
              data.top.map((c) => (
                <Pressable key={c.id} onPress={() => router.push({ pathname: "/card/[id]", params: { id: c.id, game } })} style={styles.row}>
                  <Image source={pictureUrl(c.imageUrl)} style={styles.thumb} contentFit="contain" transition={100} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{c.name}{c.quantity > 1 ? ` ×${c.quantity}` : ""}</Text>
                    <Text style={styles.meta} numberOfLines={1}>{c.setName} · {Math.round(c.share * 100)}% of the total</Text>
                  </View>
                  <Text style={styles.money}>{formatMoney(c.price * c.quantity)}</Text>
                </Pressable>
              ))
            )}
          </Section>

          <Section title="Value by set">
            {data.bySet.length === 0 ? (
              <Text style={styles.muted}>No sets yet.</Text>
            ) : (
              data.bySet.map((b) => (
                <View key={b.name} style={styles.splitRow}>
                  <Text style={[styles.splitLabel, { flex: 1 }]} numberOfLines={1}>{b.name}</Text>
                  <Text style={styles.muted}>{b.count}</Text>
                  <Text style={styles.money}>{formatMoney(b.value)}</Text>
                </View>
              ))
            )}
          </Section>
        </ScrollView>
      )}
    </View>
  );
}

function Delta({ label, now, then }: { label: string; now: number; then: number | null }) {
  if (then == null) return <Text style={styles.foot}>{label}: not enough history</Text>;
  const delta = now - then;
  const flat = Math.abs(delta) < 0.005;
  const color = flat ? colors.muted : delta > 0 ? colors.money : colors.danger;
  return (
    <Text style={styles.foot}>
      {label}: <Text style={{ color, fontWeight: "700" }}>{flat ? "Unchanged" : `${delta > 0 ? "▲" : "▼"} ${formatMoney(Math.abs(delta))}`}</Text>
    </Text>
  );
}

function MoverRow({ m, game }: { m: Mover; game: GameId }) {
  const up = m.delta > 0;
  return (
    <Pressable onPress={() => router.push({ pathname: "/card/[id]", params: { id: m.id, game } })} style={styles.row}>
      <Image source={pictureUrl(m.imageUrl)} style={styles.thumb} contentFit="contain" transition={100} />
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{m.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>{m.setName} · now {formatMoney(m.price)}</Text>
      </View>
      <Text style={[styles.money, { color: up ? colors.money : colors.danger }]}>
        {up ? "▲" : "▼"} {formatMoney(Math.abs(m.delta))} ({Math.abs(Math.round(m.pct))}%)
      </Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.h2}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: space.lg },
  backBtn: { alignSelf: "flex-start", paddingVertical: 6 },
  back: { color: colors.brandSoft, fontSize: 16, fontWeight: "600" },
  h1: { color: colors.white, fontSize: 28, fontFamily: fonts.displaySemi, letterSpacing: -0.5, marginTop: 2 },
  h2: { color: colors.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 },
  sub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  empty: { color: colors.muted, fontSize: 14, marginTop: space.lg, textAlign: "center" },
  card: { backgroundColor: colors.surface, borderColor: colors.edge, borderWidth: 1, borderRadius: radius.lg, padding: space.md },
  label: { color: colors.muted, fontSize: 12 },
  big: { color: colors.money, fontSize: 34, fontWeight: "800", marginTop: 2 },
  foot: { color: colors.muted, fontSize: 12, marginTop: 4 },
  muted: { color: colors.muted, fontSize: 13 },
  money: { color: colors.money, fontSize: 14, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 6 },
  thumb: { width: 36, height: 50, borderRadius: 4, backgroundColor: colors.surfaceRaised },
  name: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  meta: { color: colors.faint, fontSize: 12 },
  splitRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  splitLabel: { color: colors.foreground, fontSize: 14, flex: 1 },
});
