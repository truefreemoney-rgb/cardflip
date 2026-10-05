"use client";

import { searchCards } from "@/lib/cards";
import { mtgCuesOf } from "@/lib/mtgCues";
import { isSecretRareNumber, readHasPrintedKey, type PrintedNumber } from "@/lib/cardNumber";
import { GRADED_LOCKED } from "@/lib/grading";
import { marketFlagOf, quotePrice, tcgPriceOf } from "@/lib/listing";
import { UNREADABLE_CONFIDENCE, type GameId, type PokemonCard, type VisionCardRead } from "@/lib/types";
import { createServerCard, type CreateCardInput } from "@/lib/client/cardsApi";
import { uploadCardPhoto } from "@/lib/client/cardPhotoApi";

/**
 * The ad landing page's free scan (10-05, /scan): the app scanner's read →
 * catalog match, trimmed to one card (no OCR fallback, no picture tiebreak:
 * that route needs an account). The card and its photo wait in this browser
 * until the visitor signs up, then land in their Inventory (claimPendingScan,
 * called by the scanner page). It never costs one of their scans.
 */

const PENDING_KEY = "cardflip.pendingScan";
/** Set once the page priced a card: the camera is not offered again here. */
export const TRIAL_DONE_KEY = "cardflip.trialDone";

export interface TrialMatch {
  card: PokemonCard | null;
  /** Shown instead of a price when there is no card to show. */
  error: string | null;
}

/** Market price for the headline: TCGplayer market, unless the price guard flagged it. */
export function trialPrice(card: PokemonCard): number | null {
  if (marketFlagOf(card)) return null;
  return tcgPriceOf(card) ?? quotePrice(card, "Near Mint", "market")?.suggested ?? null;
}

export async function matchTrialRead(read: VisionCardRead, game: GameId): Promise<TrialMatch> {
  const g = read.game ?? game;
  if (read.detectedGame && read.detectedGame !== g && read.detectedGame !== "other" && !read.switchedFrom) {
    return { card: null, error: "That card is from a game CardFlip doesn't scan yet" };
  }
  if (typeof read.confidence === "number" && read.confidence < UNREADABLE_CONFIDENCE) {
    return { card: null, error: "Couldn't read that one. Fill the frame with the card, no glare" };
  }
  if (read.slab && GRADED_LOCKED) return { card: null, error: "Graded slabs aren't scanned yet. Try a raw card" };
  if (g === "mtg" && (read.kind === "token" || read.kind === "art")) {
    return { card: null, error: "Tokens and art cards aren't scanned. Try a playable card" };
  }
  const printed: PrintedNumber | null = readHasPrintedKey(read, g)
    ? {
        number: read.cardNumber ?? "",
        setTotal: read.setTotal,
        setCode: read.setCode,
        isSecretRare: isSecretRareNumber(read.cardNumber ?? "", read.setTotal),
        setName: read.setName,
        copyrightYear: read.copyrightYear ?? null,
        subtitle: read.subtitle ?? null,
        variant: read.variant ?? null,
        shaky: read.secondLook === "low-confidence",
      }
    : null;
  const cues = g === "mtg" ? mtgCuesOf(read) : null;
  const names = [read.name, read.englishName].filter((n): n is string => Boolean(n));
  let matches: PokemonCard[] = [];
  for (const name of names) {
    const found = await searchCards(name, printed, read.language, undefined, g, read.artStyle ?? null, false, read.firstEdition ?? null, cues).catch(() => []);
    if (found.length === 0) continue;
    if (matches.length === 0) matches = found;
    if (found[0].name.trim().toLowerCase() === name.trim().toLowerCase()) {
      matches = found;
      break;
    }
  }
  const numbersIdentify = g === "mtg" ? Boolean(printed?.setCode) : Boolean(printed?.number && printed?.setTotal) && read.language === "en";
  if (matches.length === 0 && printed && numbersIdentify) {
    matches = await searchCards("", printed, read.language, undefined, g, null, false, read.firstEdition ?? null, cues).catch(() => []);
  }
  return matches[0] ? { card: matches[0], error: null } : { card: null, error: "No match for that one. Try again, card flat and in the frame" };
}

interface PendingScan {
  input: CreateCardInput;
  photo: string | null;
  at: number;
}

export function savePendingScan(card: PokemonCard, game: GameId, photo: string | null): void {
  const market = quotePrice(card, "Near Mint", "market")?.suggested ?? null;
  const pending: PendingScan = {
    input: {
      cardName: card.englishName || card.name,
      setName: card.setName,
      cardNumber: card.number,
      imageUrl: card.imageSmall,
      condition: "Near Mint",
      price: quotePrice(card, "Near Mint", "quick")?.suggested ?? market ?? 0,
      scanPrice: market,
      game,
      catalogCardId: card.id || null,
      rarity: card.rarity ?? null,
    },
    photo,
    at: Date.now(),
  };
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Storage full or blocked: the photo is the big part, keep the card without it.
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ ...pending, photo: null }));
    } catch {
      // Nothing to keep it in; the visitor signs up without it.
    }
  }
}

/**
 * After signup, on the scanner: the waiting card becomes an Inventory row.
 * Kept until the save lands (a not-yet-confirmed inbox gets a 403 here, and
 * the next visit tries again). Returns the card's name when one was saved.
 */
export async function claimPendingScan(): Promise<string | null> {
  let pending: PendingScan | null = null;
  try {
    pending = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null");
  } catch {
    pending = null;
  }
  if (!pending?.input?.cardName) return null;
  const server = await createServerCard(pending.input);
  if (!server) return null;
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Already saved; a second claim would add a twin, but storage that can't remove can't read either.
  }
  if (pending.photo) {
    const blob = await fetch(pending.photo).then((r) => r.blob()).catch(() => null);
    if (blob) void uploadCardPhoto(server.id, new File([blob], "scan.jpg", { type: blob.type || "image/jpeg" }));
  }
  return pending.input.cardName;
}
