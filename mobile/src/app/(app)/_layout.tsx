import { Tabs } from "expo-router";
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
      <Tabs.Screen name="cards" options={{ title: "My Cards", tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>▤</Text> }} />
    </Tabs>
  );
}
