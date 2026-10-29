import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, Ellipse, RadialGradient, Stop } from "react-native-svg";
import Screen from "~/components/Screen";
import { colors, gradients, radius, space } from "~/lib/theme";

/**
 * The website's sign-in and sign-up cards, piece by piece (src/app/login/page.tsx,
 * src/app/signup/page.tsx, components/PasswordField.tsx, OnboardingSteps.tsx), so the
 * app's screens read the same: the logo over a foil-edged card on the glowing
 * background, 20 px semibold title, zinc labels, black/40 fields with an 8 px
 * radius, the red error pill, the eye on password fields, and the one-line
 * switch ("No account? Sign Up"). Chris 10-28: "plain and boring … mirror the
 * website".
 */

/** The site's rule, one address only (src/lib/emailAddress.ts): no separators, one @, a dot in the domain. */
const EMAIL_RE = /^[^\s@,;:<>"'()[\]\\]+@[^\s@,;:<>"'()[\]\\]+\.[^\s@,;:<>"'()[\]\\]+$/;
export function isValidEmail(email: string): boolean {
  if (email.length > 254 || !EMAIL_RE.test(email)) return false;
  return email.slice(email.indexOf("@") + 1).split(".").every((label) => label.length > 0);
}

export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;
/** The site's one password rule (src/lib/passwordRules.ts). */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return "That password is too long.";
  return null;
}

/** The site's 60 s gap between "Send a New Code" taps (src/lib/client/resendGap.ts). */
export function useResendGap(seconds = 60): { left: number; start: () => void } {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (until <= Date.now()) return;
    const tick = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) clearInterval(tick);
    }, 1000);
    return () => clearInterval(tick);
  }, [until]);
  return {
    left: Math.max(0, Math.ceil((until - now) / 1000)),
    start: () => {
      setNow(Date.now());
      setUntil(Date.now() + seconds * 1000);
    },
  };
}

/** The whole page: glow background, the logo, an optional steps row, then the foil card. */
export function AuthScreen({ children, steps, above }: { children: ReactNode; steps?: { labels: string[]; current: number }; above?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Screen>
      <HeroMesh />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl }]} keyboardShouldPersistTaps="handled">
          <Image source={require("../../assets/images/cardflip-logo.png")} style={styles.logo} contentFit="contain" accessibilityLabel="CardFlip" />
          {steps ? <StepsRow labels={steps.labels} current={steps.current} /> : null}
          {above}
          <FoilCard>{children}</FoilCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** The site's .hero-mesh behind /login and /signup: sky top-left, violet top-right, pink at the bottom. */
function HeroMesh() {
  const blobs = [
    ["sky", "16%", "4%", "21%", "27.5%", "rgb(125,211,252)", 0.25],
    ["violet", "84%", "10%", "25%", "30%", "rgb(167,139,250)", 0.3],
    ["pink", "50%", "100%", "23%", "25%", "rgb(240,171,252)", 0.18],
  ] as const;
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        {blobs.map(([id, , , , , color, alpha]) => (
          <RadialGradient key={id} id={id} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={color} stopOpacity={alpha} />
            <Stop offset="0.7" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        ))}
      </Defs>
      {blobs.map(([id, cx, cy, rx, ry]) => (
        <Ellipse key={id} cx={cx} cy={cy} rx={rx} ry={ry} fill={`url(#${id})`} />
      ))}
    </Svg>
  );
}

/** The site's OnboardingSteps: "1 Account — 2 Get Started", the current one in brand, done ones green with a tick. */
export function StepsRow({ labels, current }: { labels: string[]; current: number }) {
  return (
    <View style={styles.steps} accessibilityRole="list">
      {labels.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <View key={label} style={styles.step}>
            {i > 0 ? <View style={styles.stepLine} /> : null}
            <View style={[styles.stepDot, done ? { backgroundColor: "#10b981" } : active ? { backgroundColor: colors.brand } : null]}>
              <Text style={styles.stepNum}>{done ? "✓" : i + 1}</Text>
            </View>
            <Text style={[styles.stepLabel, active ? { color: colors.brand300 } : done ? { color: colors.muted } : null]}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** The site's .foil-edge panel: a 1 px holo gradient border, solid #0b0d13 inside, 16 px corners, 32 px padding. */
export function FoilCard({ children, style }: { children: ReactNode; style?: object }) {
  return (
    <LinearGradient colors={gradients.foil} locations={[0, 0.3, 0.55, 0.78, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.foil, style]}>
      <View style={styles.card}>{children}</View>
    </LinearGradient>
  );
}

/** A label over a field; `right` sits at the label's right (the site's "Forgot Password?"). */
export function Field({ label, right, children, hint }: { label: string; right?: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <View style={styles.fieldWrap}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {right}
      </View>
      {children}
      {hint}
    </View>
  );
}

/** The site's FIELD input. */
export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.placeholder} {...props} style={[styles.input, props.style]} />;
}

/**
 * The site's PasswordField: the eye shows the password; with `hint` the line under it counts
 * "N more characters" (amber) until "Long enough" (green), the way sign-up does.
 */
export function PasswordInput({ hint, value, ...rest }: TextInputProps & { hint?: boolean; value: string }) {
  const [show, setShow] = useState(false);
  const len = value.length;
  const hintText = len === 0 ? `At least ${PASSWORD_MIN} characters` : len >= PASSWORD_MIN ? "Long enough" : `${PASSWORD_MIN - len} more character${PASSWORD_MIN - len === 1 ? "" : "s"}`;
  const hintColor = len === 0 ? colors.muted : len >= PASSWORD_MIN ? colors.money : "#fcd34d";
  return (
    <View>
      <View>
        <TextInput placeholderTextColor={colors.placeholder} {...rest} value={value} secureTextEntry={!show} style={[styles.input, { paddingRight: 44 }]} />
        <Pressable onPress={() => setShow((s) => !s)} accessibilityRole="button" accessibilityLabel={show ? "Hide password" : "Show password"} hitSlop={6} style={styles.eye}>
          <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={18} color={colors.muted} />
        </Pressable>
      </View>
      {hint ? <Text style={[styles.hint, { color: hintColor }]}>{hintText}</Text> : null}
    </View>
  );
}

/** The site's error slot: a red pill under the fields. */
export function ErrorPill({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text style={styles.error} accessibilityRole="alert">
      {message}
    </Text>
  );
}

/** "No account? Sign Up" / "Already have an account? Log In": grey line, brand link. */
export function SwitchLine({ text, link, onPress, top = space.xl }: { text: string; link: string; onPress: () => void; top?: number }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ alignSelf: "center", marginTop: top }}>
      <Text style={styles.switch}>
        {text} <Text style={styles.switchLink}>{link}</Text>
      </Text>
    </Pressable>
  );
}

/** The site's secondary pill ("Send a New Code"): full width, 1 px edge, zinc text. */
export function OutlineButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.outline, pressed && { borderColor: colors.edgeStrong }, disabled && { opacity: 0.6 }]}>
      <Text style={styles.outlineText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: space.lg },
  logo: { width: 170, height: 32, alignSelf: "center", marginBottom: 32 },
  steps: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: space.xl },
  step: { flexDirection: "row", alignItems: "center", gap: 6 },
  stepLine: { width: 12, height: 1, backgroundColor: "rgba(255,255,255,0.1)", marginRight: 2 },
  stepDot: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.1)" },
  stepNum: { color: colors.white, fontSize: 10, fontWeight: "500" },
  stepLabel: { color: colors.faint, fontSize: 12, fontWeight: "500" },
  foil: { borderRadius: 16, padding: 1, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 6 },
  card: { borderRadius: 15, backgroundColor: "#0b0d13", padding: 32 },
  fieldWrap: { gap: 6 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { color: "#d4d4d8", fontSize: 14, fontWeight: "500" },
  input: { height: 46, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.edge, backgroundColor: "rgba(0,0,0,0.4)", paddingHorizontal: 12, paddingVertical: 10, color: colors.white, fontSize: 16 },
  eye: { position: "absolute", right: 0, top: 0, bottom: 0, width: 44, alignItems: "center", justifyContent: "center" },
  hint: { fontSize: 12, marginTop: 4 },
  error: { borderRadius: radius.sm, backgroundColor: "rgba(239,68,68,0.1)", paddingHorizontal: 12, paddingVertical: 8, color: colors.danger, fontSize: 12, fontWeight: "500" },
  switch: { color: colors.muted, fontSize: 14, textAlign: "center" },
  switchLink: { color: colors.brand300, fontWeight: "500" },
  outline: { borderRadius: 999, borderWidth: 1, borderColor: colors.edge, paddingHorizontal: 20, paddingVertical: 10, alignItems: "center", marginTop: 4 },
  outlineText: { color: "#e4e4e7", fontSize: 14, fontWeight: "600" },
});
