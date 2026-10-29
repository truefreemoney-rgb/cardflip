import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatMoney } from "@/lib/money";
import { GAMES, fetchCardById, pictureUrl, shownPrice, type GameId, type PokemonCard } from "~/lib/catalog";
import { colors, radius, space } from "~/lib/theme";

/**
 * Card detail (docs/APP-PLAN.md step 2): the big picture, the one price the
 * website would show (green, $X.XX), the other price rows under it, and the
 * card's facts. Read-only for now; My Cards / wishlist actions come with
 * their own steps.
 */
export default function CardDetail() {
  const { id, game: gameParam } = useLocalSearchParams<{ id: string; game?: string }>();
  const game = (gameParam && gameParam in GAMES ? gameParam : "pokemon") as GameId;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [card, setCard] = useState<PokemonCard | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    fetchCardById(id, game)
      .then((c) => live && setCard(c))
      .catch(() => live && setCard(null));
    return () => {
      live = false;
    };
  }, [id, game]);

  const picW = Math.min(width - space.lg * 2, 320);
  const price = card ? shownPrice(card) : null;
  const otherRows = card ? card.prices.filter((p) => typeof p.market === "number" && p.market > 0) : [];

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.sm }]}>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(app)/browse"))} hitSlop={8} style={styles.backBtn}>
        <Text style={styles.back}>‹ Back</Text>
      </Pressable>
      {card === undefined && <ActivityIndicator color={colors.brandSoft} style={{ marginTop: space.xl }} />}
      {card === null && <Text style={styles.empty}>{"Couldn't load this card."}</Text>}
      {card && price && (
        <ScrollView contentContainerStyle={{ alignItems: "center", paddingBottom: insets.bottom + space.xl }}>
          <Image source={pictureUrl(card.imageLarge || card.imageSmall)} style={{ width: picW, height: picW * 1.4, borderRadius: radius.lg, backgroundColor: colors.surfaceRaised }} contentFit="contain" transition={150} />
          <Text style={styles.name}>{card.name}</Text>
          <Text style={styles.meta}>
            {card.setName} · {card.number}{card.rarity ? ` · ${card.rarity}` : ""}
          </Text>
          <View style={styles.priceCard}>
            <Text style={styles.priceLabel}>{price.label ? `Market price · ${price.label}` : "Market price"}</Text>
            {price.text ? <Text style={styles.price}>{price.text}</Text> : null}
            {price.note ? <Text style={[styles.note, !price.text && { marginTop: 4 }]}>{price.note}</Text> : null}
          </View>
          {otherRows.length > 1 && (
            <View style={styles.rows}>
              {otherRows.map((p) => (
                <View key={`${p.source}-${p.variant}`} style={styles.row}>
                  <Text style={styles.rowLabel}>{p.label}{p.source === "tcgplayer" ? "" : ` · ${p.source}`}</Text>
                  <Text style={styles.rowPrice}>{formatMoney(p.market, p.currency)}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: space.lg },
  backBtn: { alignSelf: "flex-start", paddingVertical: 6, marginBottom: space.sm },
  back: { color: colors.brandSoft, fontSize: 16, fontWeight: "600" },
  empty: { color: colors.muted, fontSize: 14, marginTop: space.lg, textAlign: "center" },
  name: { color: colors.white, fontSize: 22, fontWeight: "700", marginTop: space.md, textAlign: "center" },
  meta: { color: colors.muted, fontSize: 13, marginTop: 2, textAlign: "center" },
  priceCard: { alignSelf: "stretch", marginTop: space.lg, backgroundColor: colors.surface, borderColor: colors.edge, borderWidth: 1, borderRadius: radius.lg, padding: space.lg, alignItems: "center" },
  priceLabel: { color: colors.muted, fontSize: 12 },
  price: { color: colors.money, fontSize: 36, fontWeight: "800", marginTop: 2 },
  note: { color: "#fcd34d", fontSize: 13, textAlign: "center" },
  rows: { alignSelf: "stretch", marginTop: space.md, borderColor: colors.edge, borderWidth: 1, borderRadius: radius.md },
  row: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: space.md, paddingVertical: 10, borderBottomColor: colors.edge, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { color: colors.muted, fontSize: 13 },
  rowPrice: { color: colors.foreground, fontSize: 13, fontWeight: "600" },
});
