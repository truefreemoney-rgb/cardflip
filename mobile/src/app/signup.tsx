import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "~/lib/auth";
import { pictureUrl } from "~/lib/catalog";
import { getGuestScan, type GuestScan } from "~/lib/guestScan";
import { revealPrice } from "~/lib/scan";
import { colors, fonts, radius, space } from "~/lib/theme";

/**
 * Create an account: username, email, password, same words and order as the
 * website's /signup (src/app/signup/page.tsx). After the free first scan the
 * scanned card sits above the form with its price (docs/APP-PLAN.md "First
 * open" step 4): sign up and it lands in the new account's Inventory
 * (lib/guestScan.ts claims it inside AuthProvider).
 */
const PASSWORD_MIN = 8;

export default function Signup() {
  const { signUp } = useAuth();
  const insets = useSafeAreaInsets();
  const [scan, setScan] = useState<GuestScan | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getGuestScan().then((s) => live && setScan(s));
    return () => {
      live = false;
    };
  }, []);

  async function submit() {
    setError(null);
    if (!name.trim()) return setError("Username is required.");
    if (!email.trim()) return setError("Enter your email.");
    if (password.length < PASSWORD_MIN) return setError(`Password must be at least ${PASSWORD_MIN} characters.`);
    setBusy(true);
    try {
      await signUp(name.trim(), email.trim(), password);
      // The root layout swaps to the signed-in screens on its own.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed.");
    } finally {
      setBusy(false);
    }
  }

  const price = scan ? revealPrice(scan.card, scan.condition, scan.variant) : null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xl }]} keyboardShouldPersistTaps="handled">
        <Image source={require("../../assets/images/cardflip-logo.png")} style={styles.logo} contentFit="contain" accessibilityLabel="CardFlip" />

        {scan ? (
          <View style={styles.keep}>
            <Image source={{ uri: pictureUrl(scan.card.imageSmall) ?? undefined }} style={styles.keepArt} contentFit="cover" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.keepKicker}>YOUR FIRST SCAN</Text>
              <Text style={styles.keepName} numberOfLines={1}>
                {scan.card.englishName || scan.card.name}
              </Text>
              {price?.text ? <Text style={styles.keepPrice}>{price.text}</Text> : null}
              <Text style={styles.keepNote}>Sign up and it lands in your Inventory.</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.h1}>Create your account</Text>
          <Text style={styles.sub}>5 free scans. No credit card.</Text>

          <Text style={styles.label}>Username</Text>
          <TextInput style={styles.field} value={name} onChangeText={setName} placeholder="Enter username" placeholderTextColor={colors.faint} autoCapitalize="words" autoComplete="username" textContentType="username" returnKeyType="next" editable={!busy} />

          <Text style={styles.label}>Email</Text>
          <TextInput style={styles.field} value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={colors.faint} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" returnKeyType="next" editable={!busy} />

          <Text style={styles.label}>Password</Text>
          <TextInput style={styles.field} value={password} onChangeText={setPassword} placeholder={`At least ${PASSWORD_MIN} characters`} placeholderTextColor={colors.faint} secureTextEntry autoComplete="new-password" textContentType="newPassword" returnKeyType="go" onSubmitEditing={submit} editable={!busy} />

          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          <Pressable onPress={submit} disabled={busy} style={({ pressed }) => [styles.button, pressed && { backgroundColor: colors.brandHover }, busy && { opacity: 0.7 }]}>
            {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Create Account</Text>}
          </Pressable>

          <Pressable onPress={() => router.replace("/login")} hitSlop={8} style={{ alignSelf: "center", marginTop: space.lg }}>
            <Text style={styles.link}>I already have an account</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: space.lg },
  logo: { width: 128, height: 24, alignSelf: "center", marginBottom: space.lg },
  keep: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.surface1, borderColor: colors.edge, borderWidth: 1, borderRadius: radius.lg, padding: space.md, marginBottom: space.md },
  keepArt: { width: 54, height: 75, borderRadius: 6 },
  keepKicker: { color: colors.brand300, fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  keepName: { color: colors.white, fontSize: 16, fontWeight: "600", marginTop: 2 },
  keepPrice: { color: colors.money, fontSize: 20, fontFamily: fonts.display, marginTop: 2 },
  keepNote: { color: colors.muted, fontSize: 12, marginTop: 2 },
  card: { backgroundColor: colors.surface, borderColor: colors.edge, borderWidth: 1, borderRadius: radius.xl, padding: space.xl },
  h1: { color: colors.white, fontSize: 24, fontFamily: fonts.displaySemi, letterSpacing: -0.4 },
  sub: { color: "#6ee7b7", fontSize: 14, fontWeight: "600", marginTop: 4, marginBottom: space.md },
  label: { color: "#d4d4d8", fontSize: 14, fontWeight: "500", marginTop: space.md, marginBottom: 6 },
  field: { backgroundColor: "rgba(0,0,0,0.4)", borderColor: colors.edge, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 12, color: colors.white, fontSize: 16 },
  error: { color: colors.danger, fontSize: 14, marginTop: space.md },
  button: { backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: space.xl },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: "600" },
  link: { color: colors.brandSoft, fontSize: 15, fontWeight: "600" },
});
