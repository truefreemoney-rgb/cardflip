import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { fetchCardById } from "./catalog";
import { saveScan, type Condition, type PokemonCard } from "./scan";
import type { GameId } from "./catalog";

/**
 * The first scan before any account (docs/APP-PLAN.md "First open" steps 3-4):
 * the card the guest scanned waits here until they sign up or sign in, then
 * it is saved into that account's Inventory (claim) and forgotten. The card
 * itself stays in memory; only its id, game, condition, printing and claim id
 * go to the keychain (small), so a relaunch can look the card up again.
 */
const KEY = "cardflip_guest_scan";

export interface GuestScan {
  card: PokemonCard;
  game: GameId;
  condition: Condition;
  variant: string | null;
  /**
   * The clientId every claim attempt sends to /api/cards (review 10-29): the server keeps one row per
   * clientId, so a save that landed but timed out, a second sign-in, or two overlapping claims can
   * never put the card in Inventory twice. Minted once, when the scan is stored.
   */
  claimId: string;
}

interface Stored {
  id: string;
  game: GameId;
  condition: Condition;
  variant: string | null;
  claimId?: string;
}

let pending: GuestScan | null = null;

function newClaimId(): string {
  return `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readStored(): Promise<Stored | null> {
  try {
    const raw = Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
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

export async function setGuestScan(scan: Omit<GuestScan, "claimId"> & { claimId?: string }): Promise<void> {
  pending = { ...scan, claimId: scan.claimId ?? newClaimId() };
  await writeStored(JSON.stringify({ id: pending.card.id, game: pending.game, condition: pending.condition, variant: pending.variant, claimId: pending.claimId }));
}

export async function clearGuestScan(): Promise<void> {
  pending = null;
  await writeStored(null);
}

/**
 * Whether a scan is waiting, from the keychain alone: no network, so the first-scan page can say
 * "See Your Card" at once (and offline) instead of sending the guest into a second free read.
 */
export async function hasGuestScan(): Promise<boolean> {
  if (pending) return true;
  return Boolean((await readStored())?.id);
}

/** The waiting scan, looked up again after a relaunch. */
export async function getGuestScan(): Promise<GuestScan | null> {
  if (pending) return pending;
  const stored = await readStored();
  if (!stored?.id) return null;
  try {
    const card = await fetchCardById(stored.id, stored.game);
    if (!card) return null;
    pending = { card, game: stored.game, condition: stored.condition, variant: stored.variant ?? null, claimId: stored.claimId ?? newClaimId() };
    return pending;
  } catch {
    return null;
  }
}

let claiming: Promise<boolean> | null = null;

/**
 * Save the waiting scan into the account that just signed in (the session
 * token is already stored). True when it landed; false keeps it waiting
 * (offline, or the email still to be confirmed: the save is gated until then
 * and runs again on the next sign-in or refresh). One claim at a time: a
 * second caller while one is running gets the same answer.
 */
export function claimGuestScan(): Promise<boolean> {
  if (claiming) return claiming;
  claiming = (async () => {
    const scan = await getGuestScan();
    if (!scan) return false;
    const saved = await saveScan(scan.card, scan.game, scan.condition, scan.variant, scan.claimId);
    if (!saved) return false;
    await clearGuestScan();
    return true;
  })().finally(() => {
    claiming = null;
  });
  return claiming;
}
