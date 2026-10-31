import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { openSitePage } from "~/components/AppHeader";
import { AuthScreen, ErrorPill, Field, Input, OutlineButton, PasswordInput, SwitchLine, useResendGap } from "~/components/AuthForm";
import PrimaryButton from "~/components/PrimaryButton";
import SocialSignIn from "~/components/SocialSignIn";
import { CodeRequiredError, useAuth } from "~/lib/auth";
import { colors, space } from "~/lib/theme";

/**
 * Sign in: email + password, then a 6-digit code when the account has
 * two-step on (authenticator), or the emailed code the server sends admins.
 * Same words, order and look as the website's /login (src/app/login/page.tsx).
 */
export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [mailedTo, setMailedTo] = useState<string | null>(null);
  const resendGap = useResendGap();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (needsCode && !/^\d{6}$/.test(code.trim())) {
      setError(mailedTo ? "Enter the 6-digit code from the email." : "Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    try {
      await signIn(email.trim(), password, needsCode ? code.trim() : undefined);
      // The root layout swaps to the signed-in screens on its own.
    } catch (err) {
      if (err instanceof CodeRequiredError) {
        if (needsCode) setError(err.message);
        else if (err.byEmail) {
          setMailedTo(err.message);
          resendGap.start();
        }
        setNeedsCode(true);
        setCode("");
      } else {
        setError(err instanceof Error ? err.message : "Login failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  /** Email codes only: the password again without a code mails a fresh one (the site's sendNewCode). */
  async function sendNewCode() {
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      if (err instanceof CodeRequiredError && err.byEmail) {
        setMailedTo(err.message);
        resendGap.start();
        setCode("");
      } else {
        setError(err instanceof Error ? err.message : "Login failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen>
      <Text style={styles.h1}>Welcome back</Text>
      <Text style={styles.sub}>Log in to your CardFlip account.</Text>
      <SocialSignIn mode="login" onError={setError} />

      <View style={styles.form}>
        <Field label="Email">
          <Input value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" returnKeyType="next" editable={!busy} />
        </Field>

        <Field
          label="Password"
          right={
            <Pressable onPress={() => openSitePage("/forgot-password", "Forgot Password", { public: true })} hitSlop={8}>
              <Text style={styles.forgot}>Forgot Password?</Text>
            </Pressable>
          }
        >
          <PasswordInput value={password} onChangeText={setPassword} placeholder="••••••••" autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} editable={!busy} />
        </Field>

        {needsCode ? (
          <Field
            label={mailedTo ? "Sign-In Code" : "Two-step code"}
            hint={
              mailedTo ? (
                <>
                  <Text style={styles.hint}>{mailedTo}</Text>
                  <OutlineButton label={resendGap.left > 0 ? `Send a New Code (${resendGap.left}s)` : "Send a New Code"} onPress={sendNewCode} disabled={busy || resendGap.left > 0} />
                </>
              ) : (
                <Text style={styles.hint}>Open your authenticator app and enter the current 6-digit code for CardFlip.</Text>
              )
            }
          >
            <Input value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ""))} placeholder="123456" keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} returnKeyType="go" onSubmitEditing={submit} editable={!busy} autoFocus style={styles.code} />
          </Field>
        ) : null}

        <ErrorPill message={error} />

        <PrimaryButton compact busy={busy} label={busy ? "Logging in…" : "Log In"} onPress={submit} style={{ marginTop: 20 }} />
      </View>

      <SwitchLine text="No account?" link="Sign Up" onPress={() => router.replace("/signup")} />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  h1: { color: colors.white, fontSize: 20, fontWeight: "600", letterSpacing: -0.4, lineHeight: 28 },
  sub: { color: colors.muted, fontSize: 14, marginTop: 4, lineHeight: 20 },
  form: { marginTop: 20, gap: space.lg },
  forgot: { color: colors.muted, fontSize: 14 },
  hint: { color: colors.muted, fontSize: 12 },
  code: { textAlign: "center", fontSize: 18, letterSpacing: 7 },
});
