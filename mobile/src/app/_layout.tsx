import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "~/lib/auth";
import { colors } from "~/lib/theme";

SplashScreen.preventAutoHideAsync();

/** Holds the splash until the stored session has been checked, so nobody sees a sign-in flash. */
function Root() {
  const { user } = useAuth();
  useEffect(() => {
    if (user !== undefined) SplashScreen.hideAsync();
  }, [user]);
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={user === null}>
        <Stack.Screen name="login" />
      </Stack.Protected>
      <Stack.Protected guard={Boolean(user)}>
        <Stack.Screen name="(app)" />
        <Stack.Screen name="card/[id]" />
        <Stack.Screen name="cards/sets" />
        <Stack.Screen name="cards/insights" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Root />
    </AuthProvider>
  );
}
