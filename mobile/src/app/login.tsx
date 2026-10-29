import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CodeRequiredError, useAuth } from "~/lib/auth";
import { colors, fonts, radius, space } from "~/lib/theme";

/**
 * Sign in: email + password, then a 6-digit code when the account has
 * two-step on (authenticator), or the emailed code the server sends admins.
 * Same wording and flow as the website's /login (src/app/login/page.tsx).
 */
export default function Login() {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [mailedTo, setMailedTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(withCode: boolean) {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (withCode && needsCode && !/^\d{6}$/.test(code.trim())) {
      setError(mailedTo ? "Enter the 6-digit code from the email." : "Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    try {
      await signIn(email.trim(), password, withCode && needsCode ? code.trim() : undefined);
      // The root layout swaps to the signed-in screens on its own.
    } catch (err) {
      if (err instanceof CodeRequiredError) {
        if (needsCode && withCode) setError(err.message);
        else if (err.byEmail) setMailedTo(err.message);
        setNeedsCode(true);
        setCode("");
      } else {
        setError(err instanceof Error ? err.message : "Login failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.logo}>CardFlip</Text>
        <View style={styles.card}>
          <Text style={styles.h1}>Welcome back</Text>
          <Text style={styles.sub}>Log in to your CardFlip account.</Text>

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.field}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
            editable={!busy}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.field}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.faint}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => submit(true)}
            editable={!busy}
          />

          {needsCode && (
            <>
              <Text style={styles.label}>6-digit code</Text>
              <TextInput
                style={styles.field}
                value={code}
                onChangeText={setCode}
                placeholder="123456"
                placeholderTextColor={colors.faint}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={6}
                returnKeyType="go"
                onSubmitEditing={() => submit(true)}
                editable={!busy}
                autoFocus
              />
              <Text style={styles.hint}>{mailedTo ?? "Enter the code from your authenticator app."}</Text>
              {mailedTo && (
                <Pressable onPress={() => submit(false)} disabled={busy} hitSlop={8}>
                  <Text style={styles.link}>Send a new code</Text>
                </Pressable>
              )}
            </>
          )}

          {error && (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          )}

          <Pressable onPress={() => submit(true)} disabled={busy} style={({ pressed }) => [styles.button, pressed && { backgroundColor: colors.brandHover }, busy && { opacity: 0.7 }]}>
            {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>{needsCode ? "Verify and log in" : "Log in"}</Text>}
          </Pressable>
          <Pressable onPress={() => router.replace("/signup")} hitSlop={8} style={{ alignSelf: "center", marginTop: space.lg }}>
            <Text style={styles.link}>New here? Create an account</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: space.lg },
  logo: { color: colors.white, fontSize: 28, fontWeight: "700", textAlign: "center", marginBottom: space.xl, letterSpacing: -0.5 },
  card: { backgroundColor: colors.surface, borderColor: colors.edge, borderWidth: 1, borderRadius: radius.xl, padding: space.xl },
  h1: { color: colors.white, fontSize: 24, fontFamily: fonts.displaySemi, letterSpacing: -0.4 },
  sub: { color: colors.muted, fontSize: 14, marginTop: 4, marginBottom: space.md },
  label: { color: "#d4d4d8", fontSize: 14, fontWeight: "500", marginTop: space.md, marginBottom: 6 },
  field: { backgroundColor: "rgba(0,0,0,0.4)", borderColor: colors.edge, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 12, color: colors.white, fontSize: 16 },
  hint: { color: colors.muted, fontSize: 13, marginTop: 6 },
  link: { color: colors.brandSoft, fontSize: 14, marginTop: 8 },
  error: { color: colors.danger, fontSize: 14, marginTop: space.md },
  button: { backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: space.xl },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: "600" },
});
