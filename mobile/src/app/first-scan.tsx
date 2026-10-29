import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PrimaryButton from "~/components/PrimaryButton";
import Screen from "~/components/Screen";
import { colors, fonts, radius, space } from "~/lib/theme";

/**
 * "Scan Your First Card!" (docs/APP-PLAN.md "First open" step 3, Chris 10-29
 * 1:52am): the one screen between the intro and the camera. One headline, one
 * button. Four looks (A-D, ?v=) for Chris to pick from; the losers go once he
 * has. The button opens the camera for the guest scan once that exists
 * (step 3/4); until then it lands on sign in.
 */

const BRACKET = "#818cf8";
const pikachu = require("../../assets/images/intro/pikachu-vmax.webp");
const charizard = require("../../assets/images/intro/charizard.webp");
const umbreon = require("../../assets/images/intro/umbreon.webp");

export default function FirstScan() {
  const insets = useSafeAreaInsets();
  const { v } = useLocalSearchParams<{ v?: string }>();
  const variant = (v ?? "a").toLowerCase();

  function openCamera() {
    // TODO guest scan (APP-PLAN step 3): router.push("/scan") without an account.
    router.replace("/login");
  }

  return (
    <Screen>
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <Image source={require("../../assets/images/cardflip-logo.png")} style={styles.logo} contentFit="contain" accessibilityLabel="CardFlip" />
      </View>

      <View style={styles.middle}>
        {variant === "a" && <BigCard />}
        {variant === "b" && <PriceTease />}
        {variant === "c" && <PlainBold />}
        {variant === "d" && <Fan />}
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
        <PrimaryButton label={variant === "c" ? "Scan a card" : "Open the camera"} onPress={openCamera} />
        <Pressable onPress={() => router.replace("/login")} hitSlop={8} style={{ alignSelf: "center", marginTop: space.md }}>
          <Text style={styles.link}>I already have an account</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

/** A: the headline, then the card sitting in the scanner guide, big. */
function BigCard() {
  return (
    <>
      <Text style={styles.h1}>Scan Your First Card!</Text>
      <Text style={styles.sub}>Point the camera at any card. It takes 5 seconds.</Text>
      <View style={[styles.guide, { width: "62%", marginTop: space.xl }]}>
        <Image source={pikachu} style={styles.guideCard} contentFit="cover" />
        <Corner at="tl" />
        <Corner at="tr" />
        <Corner at="bl" />
        <Corner at="br" />
      </View>
    </>
  );
}

/** B: the card with its green price riding on the corner, then the headline. */
function PriceTease() {
  return (
    <>
      <View style={{ width: "58%", marginTop: space.md }}>
        <Image source={pikachu} style={[styles.guideCard, { borderRadius: 12 }]} contentFit="cover" />
        <View style={styles.chip}>
          <Text style={styles.chipPrice}>$167.96</Text>
          <Text style={styles.chipSub}>Near Mint</Text>
        </View>
      </View>
      <Text style={[styles.h1, { marginTop: space.xl }]}>Scan Your First Card!</Text>
      <Text style={styles.sub}>See what it is worth in seconds.</Text>
    </>
  );
}

/** C: no card picture. A big camera mark, the headline, the free deal in green. */
function PlainBold() {
  return (
    <>
      <View style={styles.cameraRing}>
        <Ionicons name="camera" size={56} color={colors.white} />
      </View>
      <Text style={[styles.h1, { fontSize: 38, lineHeight: 42, marginTop: space.xl }]}>Scan Your{"\n"}First Card!</Text>
      <View style={{ marginTop: space.lg, gap: 6 }}>
        {["5 free scans", "No credit card", "Real market prices"].map((line) => (
          <Text key={line} style={styles.check}>
            ✓ {line}
          </Text>
        ))}
      </View>
    </>
  );
}

/** D: three cards fanned out like a hand, the headline under them. */
function Fan() {
  return (
    <>
      <View style={styles.fan}>
        <Image source={charizard} style={[styles.fanCard, { transform: [{ rotate: "-16deg" }, { translateX: -58 }, { translateY: 14 }] }]} contentFit="cover" />
        <Image source={umbreon} style={[styles.fanCard, { transform: [{ rotate: "16deg" }, { translateX: 58 }, { translateY: 14 }] }]} contentFit="cover" />
        <Image source={pikachu} style={[styles.fanCard, { zIndex: 2 }]} contentFit="cover" />
      </View>
      <Text style={[styles.h1, { marginTop: space.xl }]}>Scan Your First Card!</Text>
      <Text style={styles.sub}>Any game. Any card. See what it is worth.</Text>
    </>
  );
}

function Corner({ at }: { at: "tl" | "tr" | "bl" | "br" }) {
  const top = at[0] === "t";
  const left = at[1] === "l";
  return (
    <View
      pointerEvents="none"
      style={[
        styles.corner,
        top ? { top: -9 } : { bottom: -9 },
        left ? { left: -9 } : { right: -9 },
        {
          borderTopWidth: top ? 3 : 0,
          borderBottomWidth: top ? 0 : 3,
          borderLeftWidth: left ? 3 : 0,
          borderRightWidth: left ? 0 : 3,
          borderTopLeftRadius: top && left ? 8 : 0,
          borderTopRightRadius: top && !left ? 8 : 0,
          borderBottomLeftRadius: !top && left ? 8 : 0,
          borderBottomRightRadius: !top && !left ? 8 : 0,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: space.lg, alignItems: "center" },
  logo: { width: 128, height: 24 },
  middle: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.lg },
  bottom: { paddingHorizontal: space.lg, paddingTop: space.md },
  h1: { color: colors.white, fontSize: 32, lineHeight: 36, fontFamily: fonts.display, letterSpacing: -0.6, textAlign: "center" },
  sub: { color: colors.muted, fontSize: 16, lineHeight: 22, textAlign: "center", marginTop: space.sm },
  link: { color: colors.brandSoft, fontSize: 15, fontWeight: "600" },
  guide: { aspectRatio: 63 / 88, borderRadius: 10 },
  guideCard: { width: "100%", aspectRatio: 63 / 88, borderRadius: 10 },
  corner: { position: "absolute", width: 32, height: 32, borderColor: BRACKET },
  chip: {
    position: "absolute",
    right: -22,
    bottom: 18,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.edgeStrong,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  chipPrice: { color: colors.money, fontSize: 24, fontFamily: fonts.display, letterSpacing: -0.5 },
  chipSub: { color: colors.muted, fontSize: 12, marginTop: 1 },
  cameraRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#7c5cf0",
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  check: { color: "#6ee7b7", fontSize: 17, fontWeight: "600", textAlign: "center" },
  fan: { width: "100%", height: 290, alignItems: "center", justifyContent: "center" },
  fanCard: { position: "absolute", width: 150, aspectRatio: 63 / 88, borderRadius: 10 },
});
