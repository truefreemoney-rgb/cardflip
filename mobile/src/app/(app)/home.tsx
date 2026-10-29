import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "~/lib/auth";
import { API_URL } from "~/lib/api";
import { colors, radius, space } from "~/lib/theme";

/** Placeholder first screen: proves sign-in, the stored session and sign-out end to end. */
export default function Home() {
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  if (!user) return null;
  const left = user.scans?.remaining;
  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.lg }]}>
      <Text style={styles.h1}>Hi {user.name.split(" ")[0]}</Text>
      <Text style={styles.sub}>{user.email}</Text>
      <View style={styles.card}>
        <Text style={styles.row}>Scans left</Text>
        <Text style={styles.money}>{left === null || left === undefined ? "Unlimited" : String(left)}</Text>
      </View>
      <Pressable onPress={() => router.push("/scan")} style={({ pressed }) => [styles.scan, pressed && { opacity: 0.85 }]}>
        <Text style={styles.scanText}>Scan a card</Text>
      </Pressable>
      <Pressable onPress={signOut} style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
      <Text style={styles.foot}>Server: {API_URL}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: space.lg },
  h1: { color: colors.white, fontSize: 24, fontWeight: "700" },
  sub: { color: colors.muted, fontSize: 14, marginTop: 2 },
  card: { marginTop: space.lg, backgroundColor: colors.surface, borderColor: colors.edge, borderWidth: 1, borderRadius: radius.lg, padding: space.lg },
  row: { color: colors.muted, fontSize: 13 },
  money: { color: colors.money, fontSize: 28, fontWeight: "700", marginTop: 2 },
  scan: { marginTop: space.lg, backgroundColor: colors.brand, borderRadius: 999, paddingVertical: 16, alignItems: "center" },
  scanText: { color: colors.white, fontSize: 17, fontWeight: "700" },
  button: { marginTop: space.xl, borderColor: colors.edgeStrong, borderWidth: 1, borderRadius: radius.md, paddingVertical: 12, alignItems: "center" },
  buttonText: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  foot: { color: colors.faint, fontSize: 11, marginTop: space.xl },
});
