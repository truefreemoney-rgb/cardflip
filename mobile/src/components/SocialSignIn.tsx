import { StyleSheet, Text, View } from "react-native";
import AppleSignInButton from "~/components/AppleSignInButton";
import GoogleSignInButton from "~/components/GoogleSignInButton";
import { colors, space } from "~/lib/theme";

/**
 * The other ways in, at the top of the sign-in and sign-up cards exactly where
 * the website puts them (src/components/GoogleButton.tsx: Google first, then
 * the "or" rule, then the email form): Continue with Google, Sign in with
 * Apple (iOS builds only, see AppleSignInButton), then "or".
 */
export default function SocialSignIn({ mode, onError }: { mode: "login" | "signup"; onError: (message: string | null) => void }) {
  return (
    <View style={styles.wrap}>
      <GoogleSignInButton mode={mode} onError={onError} />
      <AppleSignInButton mode={mode} onError={onError} />
      <View style={styles.rule} aria-hidden>
        <View style={styles.line} />
        <Text style={styles.or}>OR</Text>
        <View style={styles.line} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space.sm, gap: space.sm },
  rule: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.edgeStrong },
  or: { color: colors.faint, fontSize: 11, letterSpacing: 2 },
});
