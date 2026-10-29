import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Where the session token lives on the phone: the iOS keychain (SecureStore).
 * On web (only used for Claude's in-pane checks against the local dev server,
 * never shipped) it falls back to localStorage, which SecureStore lacks.
 */
const KEY = "cardflip_session";

export async function readToken(): Promise<string | null> {
  try {
    if (Platform.OS === "web") return globalThis.localStorage?.getItem(KEY) ?? null;
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function writeToken(token: string | null): Promise<void> {
  try {
    if (Platform.OS === "web") {
      if (token) globalThis.localStorage?.setItem(KEY, token);
      else globalThis.localStorage?.removeItem(KEY);
      return;
    }
    if (token) await SecureStore.setItemAsync(KEY, token);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // A keychain hiccup means a fresh sign-in next launch, nothing worse.
  }
}
