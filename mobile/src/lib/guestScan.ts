import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { fetchCardById } from "./catalog";
import { saveScan, type Condition, type PokemonCard } from "./scan";
import type { GameId } from "./catalog";

/**
 * The first scan before any account (docs/APP-PLAN.md "First open" steps 3-4):
 * the card the guest scanned waits here until they sign up or sign in, then
 * it is saved into that account's Inventory (claim) and forgotten. The card
 * itself stays in memory; only its id, game, condition and printing go to the
 * keychain (small), so a relaunch can look the card up again.
 */
const KEY = "cardflip_guest_scan";

export interface GuestScan {
  card: PokemonCard;
  game: GameId;
  condition: Condition;
  variant: string | null;
}

let pending: GuestScan | null = null;

async function readStored(): Promise<{ id: string; game: GameId; condition: Condition; variant: string | null } | null> {
  try {
    const raw = Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function writeStored(value: string | null): Promise<void> {
  try {
    if (Platform.OS === "web") {
      if (value) globalThis.localStorage?.setItem(KEY, value);
      else globalThis.localStorage?.removeItem(KEY);
      return;
    }
    if (value) await SecureStore.setItemAsync(KEY, value);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Lost on relaunch at worst: the sign-up still works, the card is scanned again.
  }
}

export async function setGuestScan(scan: GuestScan): Promise<void> {
  pending = scan;
  await writeStored(JSON.stringify({ id: scan.card.id, game: scan.game, condition: scan.condition, variant: scan.variant }));
}

export async function clearGuestScan(): Promise<void> {
  pending = null;
  await writeStored(null);
}

/** The waiting scan, looked up again after a relaunch. */
export async function getGuestScan(): Promise<GuestScan | null> {
  if (pending) return pending;
  const stored = await readStored();
  if (!stored?.id) return null;
  try {
    const card = await fetchCardById(stored.id, stored.game);
    if (!card) return null;
    pending = { card, game: stored.game, condition: stored.condition, variant: stored.variant ?? null };
    return pending;
  } catch {
    return null;
  }
}

/**
 * Save the waiting scan into the account that just signed in (the session
 * token is already stored). True when it landed; false keeps it waiting
 * (offline, or the email still to be confirmed: the save is gated until then
 * and runs again on the next sign-in or refresh).
 */
export async function claimGuestScan(): Promise<boolean> {
  const scan = await getGuestScan();
  if (!scan) return false;
  const saved = await saveScan(scan.card, scan.game, scan.condition, scan.variant, null);
  if (!saved) return false;
  await clearGuestScan();
  return true;
}
