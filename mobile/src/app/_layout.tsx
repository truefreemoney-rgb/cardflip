import { BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold, useFonts } from "@expo-google-fonts/bricolage-grotesque";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "~/lib/auth";
import { colors } from "~/lib/theme";

SplashScreen.preventAutoHideAsync();

/** Holds the splash until the stored session has been checked and the headline font is in, so nobody sees a sign-in flash or a font swap. */
function Root() {
  const { user } = useAuth();
  const [fontsReady, fontError] = useFonts({ BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold });
  useEffect(() => {
    if (user !== undefined && (fontsReady || fontError)) SplashScreen.hideAsync();
  }, [user, fontsReady, fontError]);
  if (!fontsReady && !fontError) return null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={user === null}>
        {/* First open: the three swipe cards, once per install (intro.tsx). */}
        <Stack.Screen name="intro" />
        {/* Scan Your First Card! (first-scan.tsx), the screen after the intro. */}
        <Stack.Screen name="first-scan" />
        <Stack.Screen name="login" />
      </Stack.Protected>
      <Stack.Protected guard={Boolean(user)}>
        <Stack.Screen name="(app)" />
        <Stack.Screen name="scan" options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }} />
        <Stack.Screen name="card/[id]" />
        <Stack.Screen name="cards/sets" />
        <Stack.Screen name="cards/insights" />
        {/* A cardflip.io page inside the app (account, packs, wishlist, rewards, help, price check, subscribe). */}
        <Stack.Screen name="web" />
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
