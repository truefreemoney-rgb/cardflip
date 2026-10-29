import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PrimaryButton from "~/components/PrimaryButton";
import SiteWebView, { safeSitePath } from "~/components/SiteWebView";
import { colors, fonts, space } from "~/lib/theme";

/**
 * A cardflip.io page pushed over the tabs (Help, pricing, packs, rewards,
 * eBay setup) with a Back bar on top. The Watchlist and Account tabs show
 * their pages the same way without this bar ((app)/watchlist.tsx, account.tsx).
 *
 * guest=1 (10-29, the first open): a public page with no session, the card
 * page after the free first scan, with "Sign up to keep it" pinned under it
 * (Chris 2:20am: the card page sells the app, then the sign-up).
 */
export default function WebScreen() {
  const params = useLocalSearchParams<{ path?: string; title?: string; guest?: string }>();
  const path = safeSitePath(params.path);
  const title = (Array.isArray(params.title) ? params.title[0] : params.title) || "CardFlip";
  const guest = (Array.isArray(params.guest) ? params.guest[0] : params.guest) === "1";
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const back = () => (router.canGoBack() ? router.back() : router.replace(guest ? "/first-scan" : "/(app)/cards"));

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Pressable onPress={back} hitSlop={10} style={styles.backBtn}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.backBtn}>{loading ? <ActivityIndicator color={colors.brandSoft} /> : null}</View>
      </View>
      <SiteWebView path={path} onLeave={back} onLoading={setLoading} guest={guest} />
      {guest ? (
        <View style={[styles.cta, { paddingBottom: insets.bottom + space.md }]}>
          <PrimaryButton label="Sign up to keep it" onPress={() => router.push("/signup")} />
          <Text style={styles.ctaNote}>Free · No credit card · This card lands in your Inventory</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  bar: { height: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm, borderBottomColor: colors.edge, borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: colors.surface },
  backBtn: { width: 76, height: 44, justifyContent: "center" },
  back: { color: colors.brandSoft, fontSize: 17, fontWeight: "600", paddingLeft: 4 },
  title: { flex: 1, color: colors.white, fontSize: 16, fontFamily: fonts.displaySemi, textAlign: "center" },
  cta: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopColor: colors.edge, borderTopWidth: StyleSheet.hairlineWidth, backgroundColor: colors.surface },
  ctaNote: { color: "#6ee7b7", fontSize: 12, fontWeight: "600", textAlign: "center", marginTop: space.sm },
});
