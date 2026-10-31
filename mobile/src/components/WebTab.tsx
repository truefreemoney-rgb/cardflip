import { useNavigation } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import AppHeader from "~/components/AppHeader";
import Screen from "~/components/Screen";
import SiteWebView, { type SiteWebViewHandle } from "~/components/SiteWebView";
import { colors, space } from "~/lib/theme";

/**
 * A tab that shows a website page (Inventory, Search, Watchlist, Account). Chris 10-31 on build 5: inside Search's
 * card pages "no back button or proper navigation makes it impossible to use", and tapping Search only showed the
 * last card again, never the set choices. So: a "‹ Back" bar shows whenever the page has somewhere to go back to,
 * and tapping the tab you are already on starts it over at its first page (the iPhone habit).
 */
export default function WebTab({ path }: { path: string }) {
  const web = useRef<SiteWebViewHandle>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const moved = useRef(false);
  const navigation = useNavigation();

  useEffect(() => {
    const off = (navigation as unknown as { addListener(e: "tabPress", cb: () => void): () => void }).addListener("tabPress", () => {
      // Only when this tab is already showing; the first tap just switches to it, page and all.
      if (navigation.isFocused() && moved.current) {
        moved.current = false;
        web.current?.reset();
      }
    });
    return off;
  }, [navigation]);

  const onCanGoBack = (v: boolean) => {
    setCanGoBack(v);
    if (v) moved.current = true;
  };

  return (
    <Screen>
      <AppHeader />
      {canGoBack ? (
        <View style={styles.bar}>
          <Pressable onPress={() => web.current?.goBack()} hitSlop={10} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back">
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>
        </View>
      ) : null}
      <SiteWebView ref={web} path={path} onCanGoBack={onCanGoBack} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { height: 40, flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm, borderBottomColor: colors.edge, borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: colors.surface },
  backBtn: { height: 40, justifyContent: "center", paddingRight: space.lg },
  back: { color: colors.brandSoft, fontSize: 17, fontWeight: "600", paddingLeft: 4 },
});
