import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GAMES, pictureUrl, type GameId } from "~/lib/catalog";
import { STATUS_LABEL, fetchLivePrices, fetchOwnedCards, formatMoney, rowPrice, statusOf, type LivePrice, type OwnedCard, type ShownStatus } from "~/lib/collection";
import { useAuth } from "~/lib/auth";
import { colors, space } from "~/lib/theme";

type Filter = "all" | ShownStatus | "sealed";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ready", label: "Not Listed" },
  { value: "live", label: "Live" },
  { value: "ended", label: "Ended" },
  { value: "sold", label: "Sold" },
  { value: "sealed", label: "Sealed" },
];

/**
 * My Cards (docs/APP-PLAN.md step 3): every card the seller owns, newest
 * first, with today's market (the same live-prices call the website makes),
 * the website's status words, a game switch and the filters it has. Sets and
 * Insights open from the top. Read-only in this step: selling, editing and
 * deleting stay on the website until their own steps.
 */
export default function MyCards() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const pricingOnly = Boolean(user?.pricingOnly);
  const [cards, setCards] = useState<OwnedCard[] | null>(null);
  const [live, setLive] = useState<Record<string, LivePrice>>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [game, setGame] = useState<GameId>("pokemon");
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    try {
      const list = await fetchOwnedCards();
      setCards(list);
      setError(null);
      // Market after the rows, so the list shows at once and the numbers fill in.
      fetchLivePrices().then(setLive).catch(() => {});
    } catch {
      setError("Couldn't load your cards. Pull down to try again.");
      setCards((c) => c ?? []);
    }
  }, []);

  // Every time the tab comes back on screen: what was scanned on the website shows up here.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const games = useMemo(() => {
    const have = new Set((cards ?? []).map((c) => c.game));
    return (Object.keys(GAMES) as GameId[]).filter((g) => have.has(g));
  }, [cards]);
  const shownGame = games.includes(game) ? game : (games[0] ?? game);

  const rows = useMemo(() => {
    const mine = (cards ?? []).filter((c) => c.game === shownGame);
    if (filter === "all") return mine;
    if (filter === "sealed") return mine.filter((c) => c.kind === "sealed");
    return mine.filter((c) => statusOf(c) === filter);
  }, [cards, shownGame, filter]);

  // The header total: unsold copies at today's market (asking price until the market answers), like the website.
  const total = useMemo(
    () => rows.filter((c) => c.status !== "sold").reduce((sum, c) => sum + (live[c.id]?.market || c.price) * (c.quantity || 1), 0),
    [rows, live],
  );

  const filters = pricingOnly ? FILTERS.filter((f) => f.value !== "live" && f.value !== "ended") : FILTERS;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.topRow}>
        <Text style={styles.h1}>My Cards</Text>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Pressable onPress={() => router.push({ pathname: "/cards/sets", params: { game: shownGame } })} style={styles.linkBtn} hitSlop={6}>
            <Text style={styles.linkText}>Sets</Text>
          </Pressable>
          <Pressable onPress={() => router.push({ pathname: "/cards/insights", params: { game: shownGame } })} style={styles.linkBtn} hitSlop={6}>
            <Text style={styles.linkText}>Insights</Text>
          </Pressable>
        </View>
      </View>
      {games.length > 1 && (
        <View style={styles.chips}>
          {games.map((g) => (
            <Pressable key={g} onPress={() => setGame(g)} style={[styles.chip, g === shownGame && styles.chipOn]} hitSlop={4}>
              <Text style={[styles.chipText, g === shownGame && styles.chipTextOn]}>{GAMES[g].label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {cards && cards.length > 0 && (
        <View style={styles.chips}>
          {filters.map((f) => (
            <Pressable key={f.value} onPress={() => setFilter(f.value)} style={[styles.chip, f.value === filter && styles.chipOn]} hitSlop={4}>
              <Text style={[styles.chipText, f.value === filter && styles.chipTextOn]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {cards && rows.length > 0 && (
        <Text style={styles.totalLine}>
          {rows.length} {rows.length === 1 ? "card" : "cards"} · <Text style={styles.totalMoney}>{formatMoney(total)}</Text>
        </Text>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {cards === null ? (
        <ActivityIndicator color={colors.brandSoft} style={{ marginTop: space.xl }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.brandSoft} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>{cards.length === 0 ? "No cards yet" : "Nothing here"}</Text>
              <Text style={styles.empty}>{cards.length === 0 ? "Scan a card on cardflip.io and it shows up here. The in-app scanner is coming." : "Try another filter."}</Text>
            </View>
          }
          renderItem={({ item }) => <Row card={item} live={live} />}
        />
      )}
    </View>
  );
}

function Row({ card, live }: { card: OwnedCard; live: Record<string, LivePrice> }) {
  const status = statusOf(card);
  const price = rowPrice(card, live);
  const sub = card.kind === "sealed" ? card.productType ?? "Sealed" : `${card.setName} · ${card.cardNumber}${card.firstEdition ? " · 1st Edition" : ""}`;
  return (
    <Pressable
      onPress={() => card.catalogCardId && router.push({ pathname: "/card/[id]", params: { id: card.catalogCardId, game: card.game } })}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceRaised }]}
    >
      <Image source={pictureUrl(card.imageUrl)} style={styles.thumb} contentFit="contain" transition={120} />
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{card.cardName}{card.quantity > 1 ? ` ×${card.quantity}` : ""}</Text>
        <Text style={styles.sub} numberOfLines={1}>{sub}</Text>
        <View style={styles.badges}>
          <Text style={[styles.badge, styles[`badge_${status}`]]}>{STATUS_LABEL[status]}</Text>
          {card.kind === "card" && <Text style={styles.cond}>{card.condition}</Text>}
        </View>
      </View>
      <View style={{ alignItems: "flex-end", maxWidth: 120 }}>
        <Text style={styles.price}>{price.text}</Text>
        {price.note && <Text style={styles.note} numberOfLines={2}>{price.note}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: space.lg },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h1: { color: colors.white, fontSize: 24, fontWeight: "700" },
  linkBtn: { borderColor: colors.edgeStrong, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  linkText: { color: colors.foreground, fontSize: 13, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: space.sm },
  chip: { borderColor: colors.edge, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  chipTextOn: { color: colors.white },
  totalLine: { color: colors.muted, fontSize: 13, marginTop: space.md, marginBottom: space.xs },
  totalMoney: { color: colors.money, fontWeight: "700" },
  error: { color: colors.danger, fontSize: 13, marginTop: space.sm },
  emptyBox: { marginTop: space.xl, alignItems: "center", paddingHorizontal: space.lg },
  emptyTitle: { color: colors.white, fontSize: 17, fontWeight: "600" },
  empty: { color: colors.muted, fontSize: 14, marginTop: 4, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 8, borderBottomColor: colors.edge, borderBottomWidth: StyleSheet.hairlineWidth },
  thumb: { width: 44, height: 62, borderRadius: 6, backgroundColor: colors.surfaceRaised },
  name: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  sub: { color: colors.faint, fontSize: 12, marginTop: 1 },
  badges: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  badge: { fontSize: 10, fontWeight: "700", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, overflow: "hidden" },
  badge_ready: { color: colors.brandSoft, backgroundColor: "rgba(99,102,241,0.15)" },
  badge_live: { color: colors.money, backgroundColor: "rgba(52,211,153,0.15)" },
  badge_ended: { color: "#fcd34d", backgroundColor: "rgba(252,211,77,0.15)" },
  badge_sold: { color: "#7dd3fc", backgroundColor: "rgba(125,211,252,0.15)" },
  cond: { color: colors.faint, fontSize: 11 },
  price: { color: colors.money, fontSize: 16, fontWeight: "700" },
  note: { color: "#fcd34d", fontSize: 10, textAlign: "right", marginTop: 1 },
});
