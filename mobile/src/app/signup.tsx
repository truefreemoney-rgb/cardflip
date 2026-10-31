import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { openSitePage } from "~/components/AppHeader";
import { AuthScreen, ErrorPill, Field, Input, PASSWORD_MIN, PasswordInput, SwitchLine, isValidEmail, passwordProblem } from "~/components/AuthForm";
import PrimaryButton from "~/components/PrimaryButton";
import SocialSignIn from "~/components/SocialSignIn";
import { useAuth } from "~/lib/auth";
import { pictureUrl } from "~/lib/catalog";
import { getGuestScan, type GuestScan } from "~/lib/guestScan";
import { revealPrice } from "~/lib/scan";
import { colors, fonts, radius, space } from "~/lib/theme";

/**
 * Create an account: username, email, password, same words, order and look as
 * the website's /signup (src/app/signup/page.tsx), with its "1 Account — 2 Get
 * Started" steps row over the card. After the free first scan the scanned
 * card sits above the form with its price (docs/APP-PLAN.md "First open" step
 * 4): sign up and it lands in the new account's Inventory (lib/guestScan.ts
 * claims it inside AuthProvider).
 */
export default function Signup() {
  const { signUp } = useAuth();
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
    if (!name.trim()) return setError("Enter a username.");
    if (!isValidEmail(email.trim())) return setError("Enter a valid email address.");
    const pwProblem = passwordProblem(password);
    if (pwProblem) return setError(pwProblem);
    setBusy(true);
    try {
      const user = await signUp(name.trim(), email.trim(), password);
      // The site's step 2 ("You're in", How will you use it?); still waiting on the emailed code = straight in, the wall shows in the tabs.
      if (!user.mustConfirmEmail) router.replace("/welcome");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed.");
    } finally {
      setBusy(false);
    }
  }

  const price = scan ? revealPrice(scan.card, scan.condition, scan.variant) : null;
  const keep = scan ? (
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
  ) : null;

  return (
    <AuthScreen steps={{ labels: ["Account", "Get Started"], current: 0 }} above={keep}>
      <Text style={styles.h1}>Create your account</Text>
      <Text style={styles.sub}>5 free scans, no card needed.</Text>
      <SocialSignIn mode="signup" onError={setError} />

      <View style={styles.form}>
        <Field label="Username">
          <Input value={name} onChangeText={setName} placeholder="Enter username" maxLength={80} autoCapitalize="words" autoComplete="username" textContentType="username" returnKeyType="next" editable={!busy} />
        </Field>

        <Field label="Email">
          <Input value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" returnKeyType="next" editable={!busy} />
        </Field>

        <Field label="Password">
          <PasswordInput hint value={password} onChangeText={setPassword} placeholder={`At least ${PASSWORD_MIN} characters`} autoComplete="new-password" textContentType="newPassword" returnKeyType="go" onSubmitEditing={submit} editable={!busy} />
        </Field>

        <ErrorPill message={error} />

        <PrimaryButton compact busy={busy} label={busy ? "Creating Account…" : "Create Account"} onPress={submit} style={{ marginTop: 20 }} />
      </View>

      <SwitchLine text="Already have an account?" link="Log In" onPress={() => router.replace("/login")} top={20} />

      <Text style={styles.terms}>
        By continuing you agree to the{" "}
        <Text style={styles.termsLink} onPress={() => openSitePage("/terms", "Terms of Service", { public: true })}>
          Terms of Service
        </Text>{" "}
        and{" "}
        <Text style={styles.termsLink} onPress={() => openSitePage("/privacy", "Privacy Policy", { public: true })}>
          Privacy Policy
        </Text>
        .
      </Text>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  keep: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.surface1, borderColor: colors.edge, borderWidth: 1, borderRadius: radius.lg, padding: space.md, marginBottom: space.md },
  keepArt: { width: 54, height: 75, borderRadius: 6 },
  keepKicker: { color: colors.brand300, fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  keepName: { color: colors.white, fontSize: 16, fontWeight: "600", marginTop: 2 },
  keepPrice: { color: colors.money, fontSize: 20, fontFamily: fonts.display, marginTop: 2 },
  keepNote: { color: colors.muted, fontSize: 12, marginTop: 2 },
  h1: { color: colors.white, fontSize: 20, fontWeight: "600", letterSpacing: -0.4, lineHeight: 28 },
  sub: { color: colors.muted, fontSize: 14, marginTop: 4, lineHeight: 20 },
  form: { marginTop: 20, gap: space.lg },
  terms: { marginTop: 12, textAlign: "center", color: colors.muted, fontSize: 12, lineHeight: 16 },
  termsLink: { textDecorationLine: "underline" },
});
