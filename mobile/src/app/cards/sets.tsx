import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GAMES, pictureUrl, type GameId } from "~/lib/catalog";
import { fetchMissing, fetchSetProgress, formatMoney, type MissingCard, type SetProgress } from "~/lib/collection";
import { colors, fonts, radius, space } from "~/lib/theme";

/**
 * Set completion (the website's /app/collection/sets): every set the seller
 * owns a card from, how far along it is, what finishing it costs today, and
 * the cheapest cards to get there. Tap a set for the full missing list.
 */
export default function Sets() {
  const { game: gameParam } = useLocalSearchParams<{ game?: string }>();
  const game = (gameParam && gameParam in GAMES ? gameParam : "pokemon") as GameId;
  const insets = useSafeAreaInsets();
  const [sets, setSets] = useState<SetProgress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, MissingCard[] | "loading">>({});

  useEffect(() => {
    let live = true;
    fetchSetProgress(game)
      .then((s) => live && setSets(s))
      .catch(() => live && setError("Couldn't load your sets. Go back and try again."));
    return () => {
      live = false;
    };
  }, [game]);

  async function toggle(set: SetProgress) {
    if (open[set.setId]) {
      setOpen((o) => {
        const next = { ...o };
        delete next[set.setId];
        return next;
      });
      return;
    }
    setOpen((o) => ({ ...o, [set.setId]: "loading" }));
    try {
      const missing = await fetchMissing(game, set.setId);
      setOpen((o) => ({ ...o, [set.setId]: missing }));
    } catch {
      setOpen((o) => {
        const next = { ...o };
        delete next[set.setId];
        return next;
      });
      setError("Couldn't load the missing list. Try again.");
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.sm }]}>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(app)/cards"))} hitSlop={8} style={styles.backBtn}>
        <Text style={styles.back}>‹ My Cards</Text>
      </Pressable>
      <Text style={styles.h1}>Set completion</Text>
      <Text style={styles.sub}>{`Every ${GAMES[game].label} set you own a card from, what finishing it costs at today's prices, and the cheapest cards to get there.`}</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      {sets === null ? (
        <ActivityIndicator color={colors.brandSoft} style={{ marginTop: space.xl }} />
      ) : (
        <FlatList
          data={sets}
          keyExtractor={(s) => s.setId}
          contentContainerStyle={{ paddingBottom: insets.bottom + space.xl, gap: space.md, paddingTop: space.md }}
          ListEmptyComponent={<Text style={styles.empty}>No sets yet. Scan a card first.</Text>}
          renderItem={({ item }) => <SetCard set={item} open={open[item.setId]} onToggle={() => toggle(item)} game={game} />}
        />
      )}
    </View>
  );
}

function SetCard({ set, open, onToggle, game }: { set: SetProgress; open: MissingCard[] | "loading" | undefined; onToggle: () => void; game: GameId }) {
  const done = set.missing === 0;
  const list = open && open !== "loading" ? open : set.cheapest;
  return (
    <View style={styles.card}>
      <Text style={styles.setName}>{set.setName}</Text>
      <Text style={styles.setMeta}>
        {set.owned} of {set.total} · {set.pct}%{done ? " · Complete" : ` · ${set.missing} missing`}
      </Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.max(2, Math.min(100, set.pct))}%` }]} />
      </View>
      {!done && (
        <Text style={styles.cost}>
          Cost to finish <Text style={styles.money}>{formatMoney(set.costToFinish)}</Text>
          {set.unpriced > 0 ? <Text style={styles.setMeta}> + {set.unpriced} unpriced</Text> : null}
        </Text>
      )}
      {!done && list.length > 0 && (
        <View style={{ marginTop: space.sm }}>
          <Text style={styles.listTitle}>{open && open !== "loading" ? "Still missing" : "Cheapest to add"}</Text>
          {list.map((c) => (
            <Pressable key={c.id} onPress={() => router.push({ pathname: "/card/[id]", params: { id: c.id, game } })} style={styles.missRow}>
              <Image source={pictureUrl(c.imageUrl)} style={styles.thumb} contentFit="contain" transition={100} />
              <View style={{ flex: 1 }}>
                <Text style={styles.missName} numberOfLines={1}>{c.name}</Text>
                <Text style={styles.setMeta}>{c.label}</Text>
              </View>
              <Text style={styles.money}>{c.price != null ? formatMoney(c.price) : "—"}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {!done && set.missing > set.cheapest.length && (
        <Pressable onPress={onToggle} hitSlop={6} style={{ marginTop: space.sm }}>
          <Text style={styles.link}>{open === "loading" ? "Loading…" : open ? "Show the cheapest only" : `Show all ${set.missing} missing`}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: space.lg },
  backBtn: { alignSelf: "flex-start", paddingVertical: 6 },
  back: { color: colors.brandSoft, fontSize: 16, fontWeight: "600" },
  h1: { color: colors.white, fontSize: 28, fontFamily: fonts.displaySemi, letterSpacing: -0.5, marginTop: 2 },
  sub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  error: { color: colors.danger, fontSize: 13, marginTop: space.sm },
  empty: { color: colors.muted, fontSize: 14, marginTop: space.lg, textAlign: "center" },
  card: { backgroundColor: colors.surface, borderColor: colors.edge, borderWidth: 1, borderRadius: radius.lg, padding: space.md },
  setName: { color: colors.white, fontSize: 16, fontWeight: "700" },
  setMeta: { color: colors.faint, fontSize: 12, marginTop: 2 },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.08)", marginTop: 8, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.brand },
  cost: { color: colors.muted, fontSize: 13, marginTop: 8 },
  money: { color: colors.money, fontSize: 14, fontWeight: "700" },
  listTitle: { color: colors.muted, fontSize: 12, fontWeight: "600", marginBottom: 4 },
  missRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 5 },
  thumb: { width: 32, height: 45, borderRadius: 4, backgroundColor: colors.surfaceRaised },
  missName: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  link: { color: colors.brandSoft, fontSize: 13, fontWeight: "600" },
});
