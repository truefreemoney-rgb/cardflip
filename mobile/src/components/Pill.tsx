import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, gradients } from "~/lib/theme";

/**
 * The website's chip (game switch, filters): a bordered pill, and the brand
 * gradient with a soft glow when it is the one picked (.bg-brand-500).
 */
export default function Pill({ label, on, onPress, style }: { label: string; on?: boolean; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  const text = <Text style={[styles.text, on && styles.textOn]}>{label}</Text>;
  return (
    <Pressable onPress={onPress} hitSlop={4} style={({ pressed }) => [style, pressed && { opacity: 0.85 }]}>
      {on ? (
        <View style={styles.glow}>
          <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.on}>
            {text}
          </LinearGradient>
        </View>
      ) : (
        <View style={styles.off}>{text}</View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  off: { borderColor: colors.edge, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: "rgba(0,0,0,0.25)" },
  on: { borderRadius: 999, paddingHorizontal: 15, paddingVertical: 8 },
  glow: { borderRadius: 999, shadowColor: "#7c5cf0", shadowOpacity: 0.55, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  text: { color: colors.muted, fontSize: 14, fontWeight: "600" },
  textOn: { color: colors.white },
});
