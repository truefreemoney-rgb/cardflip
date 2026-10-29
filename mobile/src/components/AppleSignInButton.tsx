import * as AppleAuthentication from "expo-apple-authentication";
import { useEffect, useState } from "react";
import { Platform, StyleSheet } from "react-native";
import { useAuth } from "~/lib/auth";

/**
 * Sign in with Apple (docs/APP-PLAN.md step 6; Apple guideline 4.8: an app
 * with other sign-ins must offer Apple's). Apple's own white button, the
 * size and corner radius of the Google button above it (components/SocialSignIn.tsx).
 * Shows only where it can run: iOS with the capability (a dev / TestFlight
 * / App Store build; Expo Go and the web preview cannot, so nothing shows
 * there). Cancelling is silent; any other failure prints the server's words.
 */
export default function AppleSignInButton({ mode, onError }: { mode: "login" | "signup"; onError: (message: string | null) => void }) {
  const { signInWithApple } = useAuth();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    if (Platform.OS !== "ios") return;
    AppleAuthentication.isAvailableAsync()
      .then((ok) => live && setAvailable(ok))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!available) return null;

  async function press() {
    if (busy) return;
    onError(null);
    setBusy(true);
    try {
      await signInWithApple();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "ERR_REQUEST_CANCELED") return;
      onError(err instanceof Error ? err.message : "Sign in with Apple didn't finish.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={mode === "signup" ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
      cornerRadius={12}
      style={[styles.button, busy && { opacity: 0.7 }]}
      onPress={press}
    />
  );
}

const styles = StyleSheet.create({
  button: { width: "100%", height: 48 },
});
