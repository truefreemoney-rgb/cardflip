import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * A stable id for this install, sent on every request as x-cardflip-device
 * (the server's signupGuard.deviceIdFrom reads it where a browser would send
 * the cf_dev cookie). It is what makes the free first scan one per phone and
 * ties the sign-up that follows to that scan's device. Made once, kept in the
 * keychain beside the session token.
 */
const KEY = "cardflip_device";
let cached: string | null = null;
/** The read in flight: two early callers (the session check and a guest scan) share one id instead of minting two. */
let pending: Promise<string> | null = null;

function makeId(): string {
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export function deviceId(): Promise<string> {
  if (cached) return Promise.resolve(cached);
  if (!pending) pending = readOrMake().finally(() => (pending = null));
  return pending;
}

async function readOrMake(): Promise<string> {
  if (cached) return cached;
  try {
    const stored = Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    if (stored) return (cached = stored);
  } catch {
    // Fall through: a fresh id for this run.
  }
  const id = makeId();
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(KEY, id);
    else await SecureStore.setItemAsync(KEY, id);
  } catch {
    // Unsaved = a new device next launch; the server's caps still hold per network.
  }
  return (cached = id);
}
