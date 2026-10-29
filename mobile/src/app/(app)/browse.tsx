import { Image } from "expo-image";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GAMES, fetchSetCards, fetchSets, publicGames, pictureUrl, searchTyped, setKey, shownPrice, type GameId, type PokemonCard, type SetInfo } from "~/lib/catalog";
import { colors, radius, space } from "~/lib/theme";

const MIN_CHARS = 2;
const DEBOUNCE_MS = 350;
const SEARCH_LIMIT = 100;
const COLUMNS = 3;

/**
 * Browse / search (docs/APP-PLAN.md step 2): pick a game, type a name (or
 * "pikachu 25/102", "forest blb 280": the website's typed search), or open a
 * set from the list. Prices come through lib/catalog.ts shownPrice, the
 * website's own choice of number. Search-to-add stays free (Acorn lesson 2).
 */
export default function Browse() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tile = Math.floor((width - space.lg * 2 - space.sm * (COLUMNS - 1)) / COLUMNS);

  const [games, setGames] = useState<GameId[]>(["pokemon"]);
  const [game, setGame] = useState<GameId>("pokemon");
  const [q, setQ] = useState("");
  const [sets, setSets] = useState<SetInfo[] | null>(null);
  const [openSet, setOpenSet] = useState<SetInfo | null>(null);
  const [cards, setCards] = useState<PokemonCard[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    let live = true;
    publicGames().then((g) => {
      if (!live) return;
      setGames(g);
      setGame((cur) => (g.includes(cur) ? cur : g[0]));
    });
    return () => {
      live = false;
    };
  }, []);

  // The set list for the chosen game; refetched when the game changes (pickGame clears the screen first).
  useEffect(() => {
    let live = true;
    fetchSets(game)
      .then((s) => live && setSets(s))
      .catch(() => live && setError("Couldn't load the sets. Pull to try again."));
    return () => {
      live = false;
    };
  }, [game]);

  const pickGame = useCallback((g: GameId) => {
    ++seq.current;
    setGame(g);
    setQ("");
    setSets(null);
    setOpenSet(null);
    setCards(null);
    setError(null);
    setBusy(false);
  }, []);

  /** Typing: under two characters shows the sets again (unless a set is open); otherwise the effect below searches. */
  const onType = useCallback(
    (text: string) => {
      setQ(text);
      const term = text.trim();
      if (term.length < MIN_CHARS) {
        ++seq.current;
        if (!openSet) setCards(null);
        setBusy(false);
      } else {
        setBusy(true);
      }
    },
    [openSet],
  );

  // Debounced search, newest answer wins.
  useEffect(() => {
    const term = q.trim();
    if (term.length < MIN_CHARS) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      searchTyped(term, game, "en", { limit: SEARCH_LIMIT, exact: false })
        .then((found) => {
          if (mine !== seq.current) return;
          setOpenSet(null);
          setCards((found ?? []).filter((c) => c.imageSmall));
          setError(null);
        })
        .catch(() => mine === seq.current && setError("Search failed. Check your connection and try again."))
        .finally(() => mine === seq.current && setBusy(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, game]);

  const openSetCards = useCallback(
    (set: SetInfo) => {
      const mine = ++seq.current;
      setQ("");
      setOpenSet(set);
      setCards(null);
      setBusy(true);
      fetchSetCards(setKey(set), game)
        .then((found) => mine === seq.current && setCards(found))
        .catch(() => mine === seq.current && setError("Couldn't load that set."))
        .finally(() => mine === seq.current && setBusy(false));
    },
    [game],
  );

  const showingCards = cards !== null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.sm }]}>
      <Text style={styles.h1}>Browse</Text>
      <View style={styles.chips}>
        {games.map((g) => (
          <Pressable key={g} onPress={() => pickGame(g)} style={[styles.chip, g === game && styles.chipOn]} hitSlop={4}>
            <Text style={[styles.chipText, g === game && styles.chipTextOn]}>{GAMES[g].label}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        style={styles.search}
        value={q}
        onChangeText={onType}
        placeholder={GAMES[game].searchPlaceholder}
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
      />
      {error && <Text style={styles.error}>{error}</Text>}
      {openSet && (
        <Pressable onPress={() => { ++seq.current; setOpenSet(null); setCards(null); }} style={styles.backRow} hitSlop={6}>
          <Text style={styles.back}>‹ All sets</Text>
          <Text style={styles.setTitle} numberOfLines={1}>{openSet.name}</Text>
        </Pressable>
      )}
      {busy && !showingCards && <ActivityIndicator color={colors.brandSoft} style={{ marginTop: space.xl }} />}
      {showingCards ? (
        <FlatList
          key={`cards-${COLUMNS}`}
          data={cards}
          numColumns={COLUMNS}
          keyExtractor={(c) => c.id}
          columnWrapperStyle={{ gap: space.sm }}
          contentContainerStyle={{ gap: space.md, paddingBottom: insets.bottom + space.xl }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={busy ? <ActivityIndicator color={colors.brandSoft} /> : undefined}
          ListEmptyComponent={!busy ? <Text style={styles.empty}>{"Nothing found. Try the card's name or its number."}</Text> : undefined}
          renderItem={({ item }) => <CardTile card={item} game={game} width={tile} />}
        />
      ) : (
        <FlatList
          key="sets"
          data={sets ?? []}
          keyExtractor={(s) => setKey(s)}
          contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={sets && !busy ? <Text style={styles.empty}>No sets yet.</Text> : undefined}
          renderItem={({ item }) => <SetRow set={item} onPress={() => openSetCards(item)} />}
        />
      )}
    </View>
  );
}

function CardTile({ card, game, width }: { card: PokemonCard; game: GameId; width: number }) {
  const price = shownPrice(card);
  return (
    <Pressable onPress={() => router.push({ pathname: "/card/[id]", params: { id: card.id, game } })} style={{ width }}>
      <Image source={pictureUrl(card.imageSmall)} style={{ width, height: width * 1.4, borderRadius: radius.md, backgroundColor: colors.surfaceRaised }} contentFit="contain" transition={120} />
      <Text style={styles.tileName} numberOfLines={1}>{card.name}</Text>
      <Text style={styles.tileSet} numberOfLines={1}>{card.setName} · {card.number}</Text>
      {price.text ? <Text style={styles.tilePrice}>{price.text}</Text> : <Text style={styles.tileNote} numberOfLines={2}>{price.note}</Text>}
    </Pressable>
  );
}

function SetRow({ set, onPress }: { set: SetInfo; onPress: () => void }) {
  const cover = pictureUrl(set.coverUrl ?? set.logoUrl);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.setRow, pressed && { backgroundColor: colors.surfaceRaised }]}>
      <Image source={cover} style={styles.setCover} contentFit="contain" transition={120} />
      <View style={{ flex: 1 }}>
        <Text style={styles.setName} numberOfLines={1}>{set.name}</Text>
        <Text style={styles.setMeta} numberOfLines={1}>
          {set.releaseDate ? set.releaseDate.slice(0, 4) : ""}{set.cards ? ` · ${set.cards} cards` : ""}
        </Text>
      </View>
      <Text style={styles.chev}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: space.lg },
  h1: { color: colors.white, fontSize: 24, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: space.sm },
  chip: { borderColor: colors.edge, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  chipTextOn: { color: colors.white },
  search: { marginTop: space.sm, marginBottom: space.md, backgroundColor: "rgba(0,0,0,0.4)", borderColor: colors.edge, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11, color: colors.white, fontSize: 16 },
  error: { color: colors.danger, fontSize: 13, marginBottom: space.sm },
  backRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.sm },
  back: { color: colors.brandSoft, fontSize: 15, fontWeight: "600" },
  setTitle: { color: colors.foreground, fontSize: 15, flex: 1 },
  empty: { color: colors.muted, fontSize: 14, marginTop: space.lg, textAlign: "center" },
  tileName: { color: colors.foreground, fontSize: 12, fontWeight: "600", marginTop: 4 },
  tileSet: { color: colors.faint, fontSize: 10 },
  tilePrice: { color: colors.money, fontSize: 14, fontWeight: "700", marginTop: 1 },
  tileNote: { color: "#fcd34d", fontSize: 10, marginTop: 1 },
  setRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 8, borderBottomColor: colors.edge, borderBottomWidth: StyleSheet.hairlineWidth },
  setCover: { width: 44, height: 60, borderRadius: 6, backgroundColor: colors.surfaceRaised },
  setName: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  setMeta: { color: colors.faint, fontSize: 12, marginTop: 1 },
  chev: { color: colors.faint, fontSize: 22 },
});
