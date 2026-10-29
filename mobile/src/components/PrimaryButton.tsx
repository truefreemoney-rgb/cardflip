import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, gradients } from "~/lib/theme";

/** The website's primary button (.bg-brand-500): brand gradient, a light top edge, a violet glow underneath. */
export default function PrimaryButton({ label, onPress, disabled, style }: { label: string; onPress: () => void; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.glow, style, (pressed || disabled) && { opacity: 0.8 }]}>
      <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.button}>
        <View style={styles.sheen} pointerEvents="none" />
        <Text style={styles.label}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  glow: { borderRadius: 999, shadowColor: "#7c5cf0", shadowOpacity: 0.6, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  button: { borderRadius: 999, paddingVertical: 15, alignItems: "center", overflow: "hidden" },
  sheen: { position: "absolute", left: 0, right: 0, top: 0, height: "48%", backgroundColor: "rgba(255,255,255,0.14)" },
  label: { color: colors.white, fontSize: 17, fontWeight: "700" },
});
