import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PrimaryButton from "~/components/PrimaryButton";
import Screen from "~/components/Screen";
import { getGuestScan } from "~/lib/guestScan";
import { colors, fonts, space } from "~/lib/theme";

/**
 * "Scan Your First Card!" (docs/APP-PLAN.md "First open" step 3, Chris 10-29
 * 1:52am): the one screen between the intro and the camera. One headline, one
 * button. Look D of four (Chris 10-29 2:16am "i like D"): three cards fanned
 * like a hand, the headline under them. The button opens the camera for the
 * guest scan (scan.tsx with no session; lib/guestScan.ts keeps the card).
 */

const pikachu = require("../../assets/images/intro/pikachu-vmax.webp");
const charizard = require("../../assets/images/intro/charizard.webp");
const umbreon = require("../../assets/images/intro/umbreon.webp");

export default function FirstScan() {
  const insets = useSafeAreaInsets();
  /** A scan already made on this phone: the button says so and reopens its result page, not the camera (one free read, Chris 10-29 10:27am + 10:41am). */
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    let live = true;
    getGuestScan().then((s) => live && setWaiting(Boolean(s)));
    return () => {
      live = false;
    };
  }, []);

  function openCamera() {
    router.push(waiting ? "/first-card" : "/scan");
  }

  return (
    <Screen>
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <Image source={require("../../assets/images/cardflip-logo.png")} style={styles.logo} contentFit="contain" accessibilityLabel="CardFlip" />
      </View>

      <View style={styles.middle}>
        <Fan />
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
        <PrimaryButton label={waiting ? "See Your Card" : "Scan Your Card"} onPress={openCamera} />
        <Pressable onPress={() => router.replace("/signup")} style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.85 }]}>
          <Text style={styles.secondaryText}>Create an account</Text>
        </Pressable>
        <Pressable onPress={() => router.replace("/login")} hitSlop={8} style={{ alignSelf: "center", marginTop: space.md }}>
          <Text style={styles.link}>I already have an account</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

/** Three cards fanned out like a hand, the headline under them. */
function Fan() {
  return (
    <>
      <View style={styles.fan}>
        <Image source={charizard} style={[styles.fanCard, { transform: [{ rotate: "-16deg" }, { translateX: -58 }, { translateY: 14 }] }]} contentFit="cover" />
        <Image source={umbreon} style={[styles.fanCard, { transform: [{ rotate: "16deg" }, { translateX: 58 }, { translateY: 14 }] }]} contentFit="cover" />
        <Image source={pikachu} style={[styles.fanCard, { zIndex: 2 }]} contentFit="cover" />
      </View>
      <Text style={[styles.h1, { marginTop: space.xl }]}>Scan Your First Card!</Text>
      <Text style={styles.sub}>Pokémon, Magic, Lorcana, One Piece or Yu-Gi-Oh! See what it is worth in seconds.</Text>
    </>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: space.lg, alignItems: "center" },
  logo: { width: 128, height: 24 },
  middle: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.lg },
  bottom: { paddingHorizontal: space.lg, paddingTop: space.md },
  h1: { color: colors.white, fontSize: 32, lineHeight: 36, fontFamily: fonts.display, letterSpacing: -0.6, textAlign: "center" },
  sub: { color: colors.muted, fontSize: 16, lineHeight: 22, textAlign: "center", marginTop: space.sm },
  secondary: { marginTop: space.sm, borderRadius: 999, borderWidth: 1, borderColor: colors.edgeStrong, paddingVertical: 14, alignItems: "center" },
  secondaryText: { color: colors.white, fontSize: 16, fontWeight: "700" },
  link: { color: colors.brandSoft, fontSize: 15, fontWeight: "600" },
  fan: { width: "100%", height: 290, alignItems: "center", justifyContent: "center" },
  fanCard: { position: "absolute", width: 150, aspectRatio: 63 / 88, borderRadius: 10 },
});
