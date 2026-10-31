import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import RobotBuddy from "~/components/RobotBuddy";
import { useAuth, type SessionUser } from "~/lib/auth";
import { colors, gradients, space } from "~/lib/theme";

/** The site's bg-surface-2 (the Help button's pressed state). */
const SURFACE_2 = "rgba(175,185,255,0.12)";

/**
 * The website's app header (src/components/AppHeader.tsx), phone row: the
 * logo at the left; Help, the scan counter and the eBay chip (or Subscribe
 * for a trial) at the right; a holo hairline underneath. Help, the counter
 * and the chip open the website's own pages inside the app (app/web.tsx).
 */
/** public: a page anyone may read (Terms, Privacy, Forgot Password) opens without a session, so it works signed out. */
export function openSitePage(path: string, title: string, opts: { public?: boolean } = {}) {
  router.push({ pathname: "/web", params: opts.public ? { path, title, public: "1" } : { path, title } });
}

export default function AppHeader() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top }}>
      <View style={styles.row}>
        <Image source={require("../../assets/images/cardflip-logo.png")} style={styles.logo} contentFit="contain" accessibilityLabel="CardFlip" />
        <View style={styles.right}>
          {/* The site's NavRobot: the robot with "Help" captioned under him (phones); a tap opens the help page. */}
          <Pressable onPress={() => openSitePage("/app/help", "Help")} accessibilityLabel="Help" hitSlop={8} style={({ pressed }) => [styles.help, pressed && { backgroundColor: SURFACE_2 }]}>
            <RobotBuddy size={26} />
            <Text style={styles.helpText}>Help</Text>
          </Pressable>
          {user && !user.mustConfirmEmail && <ScanCounter user={user} />}
          {user && <EbayChip user={user} />}
        </View>
      </View>
      <LinearGradient colors={gradients.hairline} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.hairline} />
    </View>
  );
}

/** The site's ScanCounter: "3 / 5", amber at 10% left, red + "Get More Scans" at zero; a tap goes to pricing. */
function ScanCounter({ user }: { user: SessionUser }) {
  const scans = user.scans;
  if (!scans) return null;
  const fmt = (n: number) => n.toLocaleString("en-US");
  const icon = <Ionicons name="scan-outline" size={14} color="currentColor" style={{ opacity: 0.85 }} />;
  if (scans.remaining == null) {
    return (
      <View style={[styles.pill, styles.pillQuiet]}>
        <Ionicons name="scan-outline" size={14} color={colors.muted} />
        <Text style={styles.pillText}>{fmt(Number(scans.used ?? 0))} scans</Text>
      </View>
    );
  }
  const included = Number(scans.included ?? 0);
  const remaining = Number(scans.remaining);
  const subscriber = user.tier === "subscribed";
  const out = remaining <= 0;
  const low = !out && remaining <= Math.max(1, Math.round(included * 0.1));
  const tone = out ? styles.pillOut : low ? styles.pillLow : styles.pillQuiet;
  const color = out ? "#fca5a5" : low ? colors.amber : "#d4d4d8";
  void icon;
  return (
    <Pressable onPress={() => openSitePage("/pricing", "Subscribe")} hitSlop={6} style={[styles.pill, tone]}>
      <Ionicons name="scan-outline" size={14} color={color} />
      {out ? (
        <Text style={[styles.pillText, { color }]}>Get More Scans</Text>
      ) : subscriber || remaining > included ? (
        <Text style={[styles.pillText, { color }]}>
          {fmt(remaining)} <Text style={styles.pillSoft}>{subscriber ? "scans" : "free scans"}</Text>
        </Text>
      ) : (
        <Text style={[styles.pillText, { color }]}>
          {fmt(remaining)} <Text style={styles.pillSoft}>/ {fmt(included)}</Text>
        </Text>
      )}
    </Pressable>
  );
}

/** The site's header chip: eBay connected (green), Subscribe (trial), or + eBay (eBay blue). Pricing-only accounts get none. */
function EbayChip({ user }: { user: SessionUser }) {
  if (user.pricingOnly && user.tier !== "trial") return null;
  if (user.ebayConnected && !user.pricingOnly) {
    return (
      <Pressable onPress={() => openSitePage("/connect-ebay", "eBay")} hitSlop={6} style={[styles.pill, styles.pillEbayOn]}>
        <View style={styles.dot} />
        <Text style={[styles.pillText, { color: colors.money }]}>eBay</Text>
      </Pressable>
    );
  }
  if (user.tier === "trial") {
    if (user.mustConfirmEmail) return null;
    return (
      <Pressable onPress={() => openSitePage("/pricing", "Subscribe")} hitSlop={6} style={styles.subscribeGlow}>
        <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.subscribe}>
          <Text style={[styles.pillText, { color: colors.white }]}>Subscribe</Text>
        </LinearGradient>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={() => openSitePage("/connect-ebay", "eBay")} hitSlop={6} style={[styles.pill, styles.pillEbay]}>
      <Text style={[styles.pillText, { color: colors.white }]}>+ eBay</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { height: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.md },
  logo: { width: 128, height: 24 },
  right: { flexDirection: "row", alignItems: "center", gap: space.sm },
  help: { height: 36, alignItems: "center", justifyContent: "center", minWidth: 36, borderRadius: 999, paddingHorizontal: 4, paddingVertical: 2 },
  helpText: { color: "#d4d4d8", fontSize: 9, lineHeight: 9, fontWeight: "500" },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 5 },
  pillQuiet: { borderColor: colors.edge, backgroundColor: "rgba(0,0,0,0.25)" },
  pillLow: { borderColor: "rgba(251,191,36,0.4)", backgroundColor: "rgba(251,191,36,0.1)" },
  pillOut: { borderColor: "rgba(248,113,113,0.4)", backgroundColor: "rgba(239,68,68,0.1)" },
  pillEbayOn: { borderColor: "transparent", backgroundColor: "rgba(52,211,153,0.1)" },
  pillEbay: { borderColor: "transparent", backgroundColor: colors.ebay },
  pillText: { color: "#d4d4d8", fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },
  pillSoft: { fontWeight: "400", opacity: 0.7 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.money },
  subscribeGlow: { borderRadius: 999, shadowColor: "#7c5cf0", shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  subscribe: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  hairline: { height: StyleSheet.hairlineWidth * 2, width: "100%" },
});
