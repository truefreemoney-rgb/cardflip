import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "~/lib/auth";
import { API_URL } from "~/lib/api";
import { colors, radius, space } from "~/lib/theme";

/**
 * The website pages shown inside the app (web.tsx; docs/APP-PLAN.md "Hybrid"):
 * each row opens that cardflip.io page signed in. Any of these becomes a
 * native screen later by building it and repointing the row.
 */
const WEB_PAGES: { title: string; note: string; path: string }[] = [
  { title: "Account", note: "Plan, billing, eBay, password", path: "/app/account" },
  { title: "Packs", note: "Open a pack, see what you pulled", path: "/app/packs" },
  { title: "Wishlist", note: "Cards you're watching, price alerts", path: "/app/wishlist" },
  { title: "Rewards", note: "Invite a friend, bonus scans", path: "/app/rewards" },
  { title: "Price check", note: "Look a card up by name, free", path: "/app/price-check" },
  { title: "Help", note: "Ask a question, open a ticket", path: "/app/help" },
];

export default function Home() {
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  if (!user) return null;
  const left = user.scans?.remaining;
  const openWeb = (path: string, title: string) => router.push({ pathname: "/web", params: { path, title } });
  const subscribed = user.tier === "subscribed" || user.tier === "owner" || user.tier === "legacy";
  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + space.lg }]}>
      <Text style={styles.h1}>Hi {user.name.split(" ")[0]}</Text>
      <Text style={styles.sub}>{user.email}</Text>
      <View style={styles.card}>
        <Text style={styles.row}>Scans left</Text>
        <Text style={styles.money}>{left === null || left === undefined ? "Unlimited" : String(left)}</Text>
        {!subscribed && (
          <Pressable onPress={() => openWeb("/pricing", "Subscribe")} style={({ pressed }) => [styles.subscribe, pressed && { opacity: 0.85 }]}>
            <Text style={styles.subscribeText}>Subscribe</Text>
          </Pressable>
        )}
      </View>
      <Pressable onPress={() => router.push("/scan")} style={({ pressed }) => [styles.scan, pressed && { opacity: 0.85 }]}>
        <Text style={styles.scanText}>Scan a card</Text>
      </Pressable>
      <View style={styles.list}>
        {WEB_PAGES.map((p, i) => (
          <Pressable
            key={p.path}
            onPress={() => openWeb(p.path, p.title)}
            style={({ pressed }) => [styles.item, i > 0 && styles.itemDivider, pressed && { backgroundColor: colors.surfaceRaised }]}
          >
            <View style={styles.itemText}>
              <Text style={styles.itemTitle}>{p.title}</Text>
              <Text style={styles.itemNote}>{p.note}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={signOut} style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
      <Text style={styles.foot}>Server: {API_URL}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xl },
  h1: { color: colors.white, fontSize: 24, fontWeight: "700" },
  sub: { color: colors.muted, fontSize: 14, marginTop: 2 },
  card: { marginTop: space.lg, backgroundColor: colors.surface, borderColor: colors.edge, borderWidth: 1, borderRadius: radius.lg, padding: space.lg },
  row: { color: colors.muted, fontSize: 13 },
  money: { color: colors.money, fontSize: 28, fontWeight: "700", marginTop: 2 },
  subscribe: { marginTop: space.md, alignSelf: "flex-start", backgroundColor: colors.brand, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  subscribeText: { color: colors.white, fontSize: 14, fontWeight: "700" },
  scan: { marginTop: space.lg, backgroundColor: colors.brand, borderRadius: 999, paddingVertical: 16, alignItems: "center" },
  scanText: { color: colors.white, fontSize: 17, fontWeight: "700" },
  list: { marginTop: space.lg, backgroundColor: colors.surface, borderColor: colors.edge, borderWidth: 1, borderRadius: radius.lg, overflow: "hidden" },
  item: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingVertical: 12 },
  itemDivider: { borderTopColor: colors.edge, borderTopWidth: StyleSheet.hairlineWidth },
  itemText: { flex: 1 },
  itemTitle: { color: colors.white, fontSize: 16, fontWeight: "600" },
  itemNote: { color: colors.faint, fontSize: 12, marginTop: 1 },
  chevron: { color: colors.faint, fontSize: 22, marginLeft: space.sm },
  button: { marginTop: space.xl, borderColor: colors.edgeStrong, borderWidth: 1, borderRadius: radius.md, paddingVertical: 12, alignItems: "center" },
  buttonText: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  foot: { color: colors.faint, fontSize: 11, marginTop: space.xl },
});
