import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Whether this phone has seen the first-open intro (the three swipe cards,
 * docs/APP-PLAN.md "First open"). Shown once per install; Skip counts as seen.
 * Lives beside the session token (tokenStore.ts), same web fallback for the
 * in-pane checks.
 */
const KEY = "cardflip_intro_seen";

export async function readIntroSeen(): Promise<boolean> {
  try {
    if (Platform.OS === "web") return globalThis.localStorage?.getItem(KEY) === "1";
    return (await SecureStore.getItemAsync(KEY)) === "1";
  } catch {
    return false;
  }
}

export async function writeIntroSeen(): Promise<void> {
  try {
    if (Platform.OS === "web") {
      globalThis.localStorage?.setItem(KEY, "1");
      return;
    }
    await SecureStore.setItemAsync(KEY, "1");
  } catch {
    // Worst case the intro shows once more next launch.
  }
}
