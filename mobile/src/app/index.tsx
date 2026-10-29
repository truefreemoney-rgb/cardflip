import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "~/lib/auth";
import { readIntroSeen } from "~/lib/introStore";
import { colors, radius, space } from "~/lib/theme";

/**
 * Launch: the stored session decides where to land; a first open goes to the intro (once). Intro seen but no
 * account yet = the "Scan Your First Card!" page, not the login (Chris 10-29 10:19am: the 8090 build landed him on
 * the login page); that page has "I already have an account". A member launching with no signal is not signed
 * out: "No connection" + Try again until the server answers (review 10-29).
 */
export default function Index() {
  const { user, offline, refresh } = useAuth();
  const [introSeen, setIntroSeen] = useState<boolean | undefined>(undefined);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    readIntroSeen().then(setIntroSeen);
  }, []);
  if (user === undefined || introSeen === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brandSoft} />
      </View>
    );
  }
  if (user) return <Redirect href="/(app)/cards" />;
  if (offline) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>No connection</Text>
        <Text style={styles.sub}>Check your signal and try again.</Text>
        <Pressable
          onPress={async () => {
            setRetrying(true);
            await refresh();
            setRetrying(false);
          }}
          disabled={retrying}
          style={({ pressed }) => [styles.retry, pressed && { opacity: 0.85 }, retrying && { opacity: 0.7 }]}
        >
          {retrying ? <ActivityIndicator color={colors.white} /> : <Text style={styles.retryText}>Try again</Text>}
        </Pressable>
      </View>
    );
  }
  return <Redirect href={introSeen ? "/first-scan" : "/intro"} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, paddingHorizontal: space.xl, gap: space.sm },
  title: { color: colors.white, fontSize: 20, fontWeight: "600" },
  sub: { color: colors.muted, fontSize: 14, textAlign: "center" },
  retry: { marginTop: space.md, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 28, minWidth: 140, alignItems: "center" },
  retryText: { color: colors.white, fontSize: 15, fontWeight: "600" },
});
