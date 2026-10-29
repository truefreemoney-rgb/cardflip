import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import SiteWebView, { safeSitePath } from "~/components/SiteWebView";
import { colors, fonts, space } from "~/lib/theme";

/**
 * A cardflip.io page pushed over the tabs (Help, pricing, packs, rewards,
 * eBay setup) with a Back bar on top. The Watchlist and Account tabs show
 * their pages the same way without this bar ((app)/watchlist.tsx, account.tsx).
 */
export default function WebScreen() {
  const params = useLocalSearchParams<{ path?: string; title?: string }>();
  const path = safeSitePath(params.path);
  const title = (Array.isArray(params.title) ? params.title[0] : params.title) || "CardFlip";
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/(app)/cards"));

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
      <SiteWebView path={path} onLeave={back} onLoading={setLoading} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  bar: { height: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm, borderBottomColor: colors.edge, borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: colors.surface },
  backBtn: { width: 76, height: 44, justifyContent: "center" },
  back: { color: colors.brandSoft, fontSize: 17 },
  title: { flex: 1, textAlign: "center", color: colors.white, fontSize: 17, fontFamily: fonts.displaySemi },
});
