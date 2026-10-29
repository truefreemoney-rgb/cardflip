import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import SiteWebView from "~/components/SiteWebView";
import { GAMES, fetchCardById, type GameId, type PokemonCard } from "~/lib/catalog";
import { colors, fonts, space } from "~/lib/theme";

/** The public card pages' game slugs (src/lib/cardPages.ts CARD_GAME_SLUGS). */
const CARD_GAME_SLUGS: Record<GameId, string> = { pokemon: "pokemon", mtg: "magic", lorcana: "lorcana", onepiece: "one-piece", yugioh: "yugioh" };

/**
 * The address the website's card page answers to for this card. The set and
 * name slugs only decide the address, the key decides the card
 * (cardPages.ts canonicalRedirect), so a placeholder set slug lands on the
 * canonical page by one redirect. Magic keys are "<set code>-<number>"; every
 * other game keys by the catalog id (cardPages.ts cardKey).
 */
function cardPagePath(game: GameId, id: string, card: PokemonCard | null): string | null {
  if (game === "mtg") {
    if (!card?.setCode || !card.number) return null;
    return `/cards/magic/_/card--${encodeURIComponent(`${card.setCode.toLowerCase()}-${card.number}`)}`;
  }
  return `/cards/${CARD_GAME_SLUGS[game]}/_/card--${encodeURIComponent(id)}`;
}

/**
 * Card detail = the website's own card page inside the app (Chris 10-29
 * 12:22am: "anything predated need to be updated to mirror the website";
 * docs/APP-PLAN.md "Hybrid"): the picture, the market price with its
 * confidence, the price history, the price table, Buy on eBay, Watch price,
 * the card's story, other printings, the set strip and the common questions,
 * exactly as cardflip.io shows them, under the app's Back bar. The page opens
 * in app mode (no site menu or footer) through the SiteWebView handoff.
 */
export default function CardDetail() {
  const { id, game: gameParam } = useLocalSearchParams<{ id: string; game?: string }>();
  const game = (gameParam && gameParam in GAMES ? gameParam : "pokemon") as GameId;
  const insets = useSafeAreaInsets();
  const [card, setCard] = useState<PokemonCard | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/(app)/browse"));

  useEffect(() => {
    let live = true;
    fetchCardById(id, game)
      .then((c) => live && setCard(c))
      .catch(() => live && setCard(null));
    return () => {
      live = false;
    };
  }, [id, game]);

  // Pokémon, Lorcana, One Piece and Yu-Gi-Oh! need no lookup for the address; Magic waits for the set code.
  const path = game === "mtg" ? (card === undefined ? null : cardPagePath(game, id, card)) : cardPagePath(game, id, null);
  const title = card?.englishName || card?.name || "Card";

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Pressable onPress={back} hitSlop={10} style={styles.backBtn}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.backBtn}>{loading && path ? <ActivityIndicator color={colors.brandSoft} /> : null}</View>
      </View>
      {path ? (
        <SiteWebView path={path} onLeave={back} onLoading={setLoading} />
      ) : card === null || (game === "mtg" && card !== undefined) ? (
        <Text style={styles.empty}>{"Couldn't load this card."}</Text>
      ) : (
        <ActivityIndicator color={colors.brandSoft} style={{ marginTop: space.xl }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  bar: { height: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm, borderBottomColor: colors.edge, borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: colors.surface },
  backBtn: { width: 76, height: 44, justifyContent: "center" },
  back: { color: colors.brandSoft, fontSize: 17 },
  title: { flex: 1, textAlign: "center", color: colors.white, fontSize: 17, fontFamily: fonts.displaySemi },
  empty: { color: colors.muted, fontSize: 14, marginTop: space.lg, textAlign: "center" },
});
