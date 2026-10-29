import { Tabs, router } from "expo-router";
import { Text } from "react-native";
import { colors } from "~/lib/theme";

/** The signed-in app: tabs grow here as screens land (docs/APP-PLAN.md order of work). */
export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.edge },
        tabBarActiveTintColor: colors.brandSoft,
        tabBarInactiveTintColor: colors.faint,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="home" options={{ title: "Home", tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>⌂</Text> }} />
      <Tabs.Screen name="browse" options={{ title: "Browse", tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>⌕</Text> }} />
      {/* The scanner is a full-screen sheet over the tabs, not a tab of its own: the tab only opens it. */}
      <Tabs.Screen
        name="scanTab"
        options={{ title: "Scan", tabBarIcon: () => <Text style={{ color: colors.brandSoft, fontSize: 20 }}>◎</Text> }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push("/scan");
          },
        }}
      />
      <Tabs.Screen name="cards" options={{ title: "My Cards", tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>▤</Text> }} />
    </Tabs>
  );
}
