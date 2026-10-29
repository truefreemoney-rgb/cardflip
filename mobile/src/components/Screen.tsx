import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { colors, gradients } from "~/lib/theme";

/** A screen with the website's body background: dark, with the brand glow bleeding in from the top. */
export default function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[styles.screen, style]}>
      <LinearGradient pointerEvents="none" colors={gradients.glow} locations={[0, 0.45, 1]} style={styles.glow} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  glow: { position: "absolute", left: 0, right: 0, top: 0, height: 380 },
});
