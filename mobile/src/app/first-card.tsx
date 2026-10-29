import { Image } from "expo-image";
import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PriceChart from "~/components/PriceChart";
import PrimaryButton from "~/components/PrimaryButton";
import Screen from "~/components/Screen";
import { pictureUrl } from "~/lib/catalog";
import { getGuestScan, type GuestScan } from "~/lib/guestScan";
import { defaultVariantOf, revealPrice } from "~/lib/scan";
import { colors, fonts, space } from "~/lib/theme";

/**
 * The free first scan's result, a full page (docs/APP-PLAN.md "First open"
 * step 4; Chris 10-29 10:27am): the camera is gone, the card and its price
 * are the whole screen, and the only ways on are "Sign up to keep it" and
 * "I already have an account". The scanner replaces itself with this page
 * the moment the guest read lands, so the free read cannot be repeated from
 * a reveal left open in the back. With no waiting scan the page hands over to
 * "Scan Your First Card!".
 */
export default function FirstCard() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [scan, setScan] = useState<GuestScan | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    getGuestScan().then((s) => live && setScan(s));
    return () => {
      live = false;
    };
  }, []);

  if (scan === undefined) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brandSoft} />
      </View>
    );
  }
  if (!scan) return <Redirect href="/first-scan" />;

  const { card, condition, variant } = scan;
  const price = revealPrice(card, condition, variant);
  const lines = card.prices.filter((p) => p.currency === "USD" && p.market != null && p.market > 0);
  const printing = lines.length > 1 ? (lines.find((p) => p.variant === (variant ?? defaultVariantOf(card)))?.label ?? price.label) : null;
  const copy = [condition, printing].filter(Boolean).join(" · ");

  return (
    <Screen>
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <Image source={require("../../assets/images/cardflip-logo.png")} style={styles.logo} contentFit="contain" accessibilityLabel="CardFlip" />
      </View>

      <ScrollView contentContainerStyle={styles.middle} showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker}>MATCH FOUND</Text>
        <Image source={{ uri: pictureUrl(card.imageLarge || card.imageSmall) ?? undefined }} style={styles.art} contentFit="cover" transition={200} />
        <Text style={styles.name}>{card.englishName || card.name}</Text>
        <Text style={styles.set}>
          {card.setName}
          {card.rarity ? ` · ${card.rarity}` : ""}
          {card.number ? ` · #${card.number}` : ""}
        </Text>
        <Text style={styles.price}>{price.text ?? "No price yet"}</Text>
        {price.text ? <Text style={styles.priceLabel}>MARKET PRICE</Text> : null}
        <Text style={styles.copy}>{copy}</Text>
        <View style={{ marginTop: space.md, alignSelf: "stretch" }}>
          <PriceChart cardId={card.id} variant={variant ?? defaultVariantOf(card)} width={width - space.lg * 2} />
        </View>
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
        <PrimaryButton label="Sign up to keep it" onPress={() => router.replace("/signup")} />
        <Text style={styles.deal}>Free · No credit card · This card lands in your Inventory</Text>
        <Pressable onPress={() => router.replace("/login")} hitSlop={8} style={{ alignSelf: "center", marginTop: space.md }}>
          <Text style={styles.link}>I already have an account</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: space.lg, alignItems: "center" },
  logo: { width: 128, height: 24 },
  middle: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.lg, paddingVertical: space.md },
  kicker: { color: colors.money, fontSize: 12, fontWeight: "800", letterSpacing: 2, marginBottom: space.sm },
  art: { width: 176, height: 246, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  name: { color: colors.white, fontSize: 24, lineHeight: 28, fontFamily: fonts.display, letterSpacing: -0.4, textAlign: "center", marginTop: space.md },
  set: { color: colors.muted, fontSize: 14, lineHeight: 18, textAlign: "center", marginTop: 4 },
  price: { color: colors.money, fontSize: 36, lineHeight: 42, fontFamily: fonts.displaySemi, fontVariant: ["tabular-nums"], textAlign: "center", marginTop: space.md },
  priceLabel: { color: colors.faint, fontSize: 10, letterSpacing: 1.5, textAlign: "center" },
  copy: { color: colors.foreground, fontSize: 14, textAlign: "center", marginTop: space.sm },
  bottom: { paddingHorizontal: space.lg, paddingTop: space.md },
  deal: { color: "#6ee7b7", fontSize: 12, fontWeight: "600", textAlign: "center", marginTop: space.sm },
  link: { color: colors.brandSoft, fontSize: 15, fontWeight: "600" },
});
