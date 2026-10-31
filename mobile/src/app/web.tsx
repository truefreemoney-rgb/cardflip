import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PrimaryButton from "~/components/PrimaryButton";
import SiteWebView, { safeSitePath } from "~/components/SiteWebView";
import { useAuth } from "~/lib/auth";
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
  const params = useLocalSearchParams<{ path?: string; title?: string; guest?: string; public?: string }>();
  const path = safeSitePath(params.path);
  const title = (Array.isArray(params.title) ? params.title[0] : params.title) || "CardFlip";
  const guest = (Array.isArray(params.guest) ? params.guest[0] : params.guest) === "1";
  // public=1 (10-31, App Review): Terms / Privacy / Forgot Password from the sign-in screens load with no session
  // (they showed "Sign in again" to a signed-out user), without the guest page's sign-up bar.
  const open = guest || (Array.isArray(params.public) ? params.public[0] : params.public) === "1";
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const { user, refresh } = useAuth();
  const back = () => {
    // Pricing, packs or rewards may have changed the scan count on the server: re-read it so the native
    // header is right the moment the page closes (Chris 10-29 5:26pm "how will they refresh?").
    if (user) void refresh();
    if (router.canGoBack()) router.back();
    else router.replace(guest ? "/first-scan" : "/(app)/cards");
  };

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
      <SiteWebView path={path} onLeave={back} onLoading={setLoading} guest={open} />
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
