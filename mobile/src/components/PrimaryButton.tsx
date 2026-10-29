import { LinearGradient } from "expo-linear-gradient";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, gradients } from "~/lib/theme";

/**
 * The website's primary button (.bg-brand-500): brand gradient, a light top edge, a violet glow
 * underneath; pressed, it lightens the way the site does on hover. `compact` is the form submit
 * (the site's py-3 text-sm pill on /login and /signup); `busy` shows the spinner beside the label.
 */
export default function PrimaryButton({ label, onPress, disabled, busy, compact, style }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; compact?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} style={({ pressed }) => [styles.glow, style, disabled && { opacity: 0.6 }]}>
      {({ pressed }) => (
        <LinearGradient colors={pressed ? gradients.brandPressed : gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.button, compact && styles.compact]}>
          <View style={styles.sheen} pointerEvents="none" />
          {busy ? <ActivityIndicator color={colors.white} size="small" style={{ marginRight: 8 }} /> : null}
          <Text style={[styles.label, compact && styles.labelCompact]}>{label}</Text>
        </LinearGradient>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  glow: { borderRadius: 999, shadowColor: "#7c5cf0", shadowOpacity: 0.6, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  button: { flexDirection: "row", borderRadius: 999, paddingVertical: 15, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  compact: { paddingVertical: 12, paddingHorizontal: 20 },
  sheen: { position: "absolute", left: 0, right: 0, top: 0, height: "48%", backgroundColor: "rgba(255,255,255,0.14)" },
  label: { color: colors.white, fontSize: 17, fontWeight: "700" },
  labelCompact: { fontSize: 14, fontWeight: "600", lineHeight: 20 },
});
