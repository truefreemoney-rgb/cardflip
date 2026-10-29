import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { openSitePage } from "~/components/AppHeader";
import { AuthScreen } from "~/components/AuthForm";
import { api } from "~/lib/api";
import { useAuth } from "~/lib/auth";
import { colors, fonts } from "~/lib/theme";

const TRIAL_SCANS = 5;

/**
 * The website's step 2 after sign-up (src/app/signup/page.tsx "ebay" phase):
 * "You're in, {name}", the free-scan line, "How will you use it?" with the
 * two choices (I sell on eBay / I collect = the account's pricing-only
 * switch, PATCH /api/account), the "change it any time" note and "Or
 * Subscribe Now". Reached from the email, Google and Apple sign-ups when the
 * account is new; the choice lands on the Scanner tab (the site's /app) or,
 * with no free scans left, the pricing page.
 */
export default function Welcome() {
  const { user, refresh } = useAuth();
  const [choosing, setChoosing] = useState<"sell" | "price" | null>(null);
  const firstName = user?.name.split(" ")[0] ?? "";
  const scansLeft = user?.trialScansLeft ?? TRIAL_SCANS;

  async function chooseMode(mode: "sell" | "price") {
    if (choosing) return;
    setChoosing(mode);
    try {
      await api("/api/account", { method: "PATCH", body: { pricingOnly: mode === "price" } });
      await refresh();
    } catch {
      // Moving on anyway: the choice can be made again from Inventory.
    }
    if (scansLeft > 0) router.replace("/(app)/scanTab");
    else {
      router.replace("/(app)/cards");
      openSitePage("/pricing", "Subscribe");
    }
  }

  return (
    <AuthScreen steps={{ labels: ["Account", "Get Started"], current: 1 }}>
      <View style={styles.center}>
        <View style={styles.tick} accessibilityElementsHidden>
          <Text style={styles.tickText}>✓</Text>
        </View>
        <Text style={styles.h1}>You&apos;re in{firstName ? `, ${firstName}` : ""}</Text>
        {scansLeft > 0 ? (
          <Text style={styles.sub}>Your first {scansLeft === 1 ? "scan is" : `${scansLeft} scans are`} free. Point your camera at a card and CardFlip names it and prices it.</Text>
        ) : (
          <Text style={styles.sub}>The free scans have already been used on this device or network, so pick a plan to start scanning.</Text>
        )}

        <Text style={styles.question}>How will you use it?</Text>
        <View style={styles.choices}>
          {(
            [
              ["sell", "I sell on eBay", "Scan, price, and list cards on eBay in one tap."],
              ["price", "I collect", "Market prices and what your cards are worth. Nothing about eBay."],
            ] as const
          ).map(([mode, title, line]) => (
            <Pressable key={mode} disabled={choosing !== null} onPress={() => void chooseMode(mode)} style={({ pressed }) => [styles.choice, pressed && styles.choiceOn, choosing !== null && { opacity: 0.6 }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.choiceTitle}>{title}</Text>
                <Text style={styles.choiceLine}>{line}</Text>
              </View>
              {choosing === mode ? <ActivityIndicator color={colors.brand300} size="small" /> : <Text style={styles.arrow}>→</Text>}
            </Pressable>
          ))}
        </View>
        <Text style={styles.note}>You can change this any time from Account or Inventory.</Text>

        {scansLeft > 0 ? (
          <Pressable onPress={() => openSitePage("/pricing", "Subscribe")} hitSlop={8} style={{ marginTop: 20 }}>
            <Text style={styles.subscribe}>Or Subscribe Now</Text>
          </Pressable>
        ) : null}
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center" },
  tick: { width: 56, height: 56, borderRadius: 16, backgroundColor: "rgba(16,185,129,0.15)", alignItems: "center", justifyContent: "center" },
  tickText: { color: colors.money, fontSize: 24 },
  h1: { color: colors.white, fontSize: 20, fontWeight: "600", letterSpacing: -0.4, lineHeight: 28, marginTop: 20, textAlign: "center" },
  sub: { color: colors.muted, fontSize: 14, lineHeight: 22, marginTop: 8, textAlign: "center" },
  question: { color: colors.white, fontSize: 18, fontFamily: fonts.displaySemi, marginTop: 24, textAlign: "center" },
  choices: { alignSelf: "stretch", gap: 10, marginTop: 12 },
  choice: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.edge, backgroundColor: colors.surface1, paddingHorizontal: 16, paddingVertical: 14 },
  choiceOn: { borderColor: colors.brandSoft, backgroundColor: "rgba(99,102,241,0.1)" },
  choiceTitle: { color: colors.white, fontSize: 16, fontWeight: "600" },
  choiceLine: { color: colors.muted, fontSize: 13, lineHeight: 17, marginTop: 2 },
  arrow: { color: colors.brand300, fontSize: 16 },
  note: { color: colors.faint, fontSize: 12, marginTop: 12, textAlign: "center" },
  subscribe: { color: colors.brand300, fontSize: 14, fontWeight: "500" },
});
