import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold } from "@expo-google-fonts/geist";
import type { ReactElement } from "react";
import { StyleSheet, Text, TextInput, type TextStyle } from "react-native";

/**
 * The website's body font (src/app/layout.tsx: Geist for everything, Bricolage
 * Grotesque for headlines) on every Text and TextInput in the app, so the app
 * reads like the site (Chris 10-28: "mirror the website 1:1"). React Native has
 * no page-wide font, and a Google font ships one file per weight, so this
 * patches Text and TextInput once: a style's fontWeight picks the Geist file
 * and is dropped (faux-bold otherwise); a style that names a fontFamily
 * (the Bricolage headlines) is left alone.
 */
export const GEIST = { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold };

function geistFor(weight: TextStyle["fontWeight"]): string {
  const w = typeof weight === "number" ? weight : weight ? parseInt(weight, 10) : 400;
  if (weight === "bold" || w >= 700) return "Geist_700Bold";
  if (weight === "semibold" || w >= 600) return "Geist_600SemiBold";
  if (weight === "medium" || w >= 500) return "Geist_500Medium";
  return "Geist_400Regular";
}

/** Flattened, with Geist in place of the weight. Exported for the tests. */
export function withGeist(style: TextStyle | TextStyle[] | undefined): TextStyle {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  if (flat.fontFamily) return flat;
  const { fontWeight, ...rest } = flat;
  return { ...rest, fontFamily: geistFor(fontWeight) };
}

let patched = false;
/** Call once, after useFonts(GEIST) resolved. */
export function applyGeistEverywhere() {
  if (patched) return;
  patched = true;
  // Both are forwardRef components (native and react-native-web): render(props, ref). The font goes
  // in on the props side, before each platform turns the style into native attributes or CSS.
  type Props = { style?: TextStyle | TextStyle[] };
  for (const Component of [Text, TextInput] as unknown as { render: (props: Props, ref: unknown) => ReactElement }[]) {
    const render = Component.render;
    if (typeof render !== "function") continue;
    Component.render = function patchedRender(this: unknown, props: Props, ref: unknown) {
      return render.call(this, { ...props, style: withGeist(props.style) }, ref);
    };
  }
}
