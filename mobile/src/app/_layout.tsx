import { BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold, useFonts } from "@expo-google-fonts/bricolage-grotesque";
import * as AppIntents from "expo-app-intents";
import { useQuickActionRouting } from "expo-quick-actions/router";
import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef } from "react";
import { AuthProvider, useAuth } from "~/lib/auth";
import { colors } from "~/lib/theme";

SplashScreen.preventAutoHideAsync();

/**
 * The scanner shortcuts (docs/APP-PLAN.md step 6, 10-29): a Home Screen quick
 * action ("Scan a card", app.json expo-quick-actions, routed to /scan by
 * useQuickActionRouting) and the "Scan a card" App Shortcut (app-intents/
 * ScanCardIntent.swift) that iOS offers in the Shortcuts app, the Action
 * Button, the Lock Screen / Control Center shortcut control and Siri. Both
 * open the camera: signed out it is the free first scan, signed in the
 * normal scanner. Nothing here runs in Expo Go or on the web (the hooks are
 * no-ops without the native modules).
 */
function ScannerShortcuts() {
  useQuickActionRouting();
  const handled = useRef(new Set<string>());
  AppIntents.useAppIntents(async (pending) => {
    for (const invocation of pending) {
      if (invocation.name === "scanCard" && !handled.current.has(invocation.id)) {
        handled.current.add(invocation.id);
        router.push("/scan");
      }
      await AppIntents.removePendingInvocationAsync(invocation.id);
    }
  });
  return null;
}

/** Holds the splash until the stored session has been checked and the headline font is in, so nobody sees a sign-in flash or a font swap. */
function Root() {
  const { user } = useAuth();
  const [fontsReady, fontError] = useFonts({ BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold });
  useEffect(() => {
    if (user !== undefined && (fontsReady || fontError)) SplashScreen.hideAsync();
  }, [user, fontsReady, fontError]);
  if (!fontsReady && !fontError) return null;
  return (
    <>
    <ScannerShortcuts />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={user === null}>
        {/* First open: the three swipe cards, once per install (intro.tsx). */}
        <Stack.Screen name="intro" />
        {/* Scan Your First Card! (first-scan.tsx), the screen after the intro. */}
        <Stack.Screen name="first-scan" />
        <Stack.Screen name="signup" />
        <Stack.Screen name="login" />
      </Stack.Protected>
      {/* Shared: the camera (the free first scan before an account, then the signed-in scanner) and a site page (the guest card page). */}
      <Stack.Screen name="scan" options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }} />
      <Stack.Screen name="web" />
      <Stack.Protected guard={Boolean(user)}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
    </>
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
