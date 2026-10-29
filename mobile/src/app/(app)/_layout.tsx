import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { StyleSheet, View, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "~/lib/theme";

/** The first tab on launch is Inventory (the website's first tab too); the camera waits for a tap. */
export const unstable_settings = { initialRouteName: "cards" };

/**
 * The website's phone tab bar (src/components/BottomTabBar.tsx), tab for tab:
 * Inventory · Search · Scanner (the raised pill in the middle) · Watchlist ·
 * Account. Every tab shows the website's own page inside the app
 * (SiteWebView), 1:1 with the site (Chris 10-29); only the camera is native
 * (/scan), opened from the Scanner page's "Add Cards".
 */
type IconName = React.ComponentProps<typeof Ionicons>["name"];

function TabIcon({ name, color, focused }: { name: IconName; color: ColorValue; focused: boolean }) {
  return (
    <View style={[styles.icon, focused && styles.iconOn]}>
      <Ionicons name={name} size={22} color={typeof color === "string" ? color : undefined} />
    </View>
  );
}

export default function AppLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // 56px of bar over the home-bar inset, like the website's h-14 + env(safe-area-inset-bottom).
        tabBarStyle: { backgroundColor: colors.tabBar, borderTopColor: colors.edgeStrong, borderTopWidth: StyleSheet.hairlineWidth, height: 60 + insets.bottom, paddingTop: 4, paddingBottom: insets.bottom + 4 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "500", marginTop: 2 },
        tabBarActiveTintColor: colors.brand300,
        tabBarInactiveTintColor: colors.muted,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="cards" options={{ title: "Inventory", tabBarIcon: ({ color, focused }) => <TabIcon name="albums-outline" color={color} focused={focused} /> }} />
      <Tabs.Screen name="browse" options={{ title: "Search", tabBarIcon: ({ color, focused }) => <TabIcon name="search-outline" color={color} focused={focused} /> }} />
      <Tabs.Screen
        name="scanTab"
        options={{
          title: "Scanner",
          tabBarIcon: () => (
            <View style={styles.scan}>
              <Ionicons name="scan-outline" size={24} color={colors.brand200} />
            </View>
          ),
        }}
      />
      <Tabs.Screen name="watchlist" options={{ title: "Watchlist", tabBarIcon: ({ color, focused }) => <TabIcon name="heart-outline" color={color} focused={focused} /> }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: ({ color, focused }) => <TabIcon name="person-outline" color={color} focused={focused} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: { height: 28, width: 48, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  iconOn: { backgroundColor: "rgba(99,102,241,0.2)" },
  scan: { height: 36, width: 56, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(99,102,241,0.25)" },
});
