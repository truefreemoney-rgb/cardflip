"use client";

import { searchCards } from "@/lib/cards";
import { mtgCuesOf } from "@/lib/mtgCues";
import { isSecretRareNumber, readHasPrintedKey, type PrintedNumber } from "@/lib/cardNumber";
import { GRADED_LOCKED } from "@/lib/grading";
import { marketFlagOf, quotePrice, tcgPriceOf } from "@/lib/listing";
import { UNREADABLE_CONFIDENCE, type GameId, type PokemonCard, type VisionCardRead } from "@/lib/types";
import { createServerCard, type CreateCardInput } from "@/lib/client/cardsApi";
import { uploadCardPhoto } from "@/lib/client/cardPhotoApi";
import { apiFetch } from "@/lib/client/basePath";

/**
 * The ad landing page's free scan (10-05, /scan): the app scanner's read →
 * catalog match, trimmed to one card (no OCR fallback, no picture tiebreak:
 * that route needs an account). The card and its photo wait in this browser
 * until the visitor signs up, then land in their Inventory (claimPendingScan,
 * called by the scanner page). It never costs one of their scans.
 *
 * The confirm link opens in a different browser from the one they signed up in
 * (TikTok's in-app browser cannot run the camera), and localStorage does not
 * travel, so at signup the card is also parked on the server
 * (pushPendingScan, /api/trial/pending) and claimPendingScan falls back to it.
 */

const PENDING_KEY = "cardflip.pendingScan";
/** Set once this browser's card is parked on the server: from then on the server copy is the one that counts. */
const PUSHED_KEY = "cardflip.pendingScanPushed";
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

/** Server copy cap: a bigger photo is dropped, the card is kept (mirrors the route). */
const MAX_PHOTO_CHARS = 600_000;

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

function readLocalPending(): PendingScan | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null") as PendingScan | null;
    return p?.input?.cardName ? p : null;
  } catch {
    return null;
  }
}

/**
 * Right after the account exists (signup page, and the wall for a walled
 * account): park this browser's waiting card on the server so the browser the
 * confirm link opens in can find it. A no-op with nothing waiting; the local
 * copy stays until the card is saved. Never throws.
 */
export async function pushPendingScan(): Promise<void> {
  const pending = readLocalPending();
  if (!pending) return;
  const photo = pending.photo && pending.photo.length <= MAX_PHOTO_CHARS ? pending.photo : null;
  try {
    const res = await apiFetch("/api/trial/pending", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: pending.input, photo }),
    });
    if (res.ok) localStorage.setItem(PUSHED_KEY, "1");
  } catch {
    // Offline: this browser still has its own copy.
  }
}

/** The server copy; null = the server has none; "unknown" = could not ask (signed out, offline). */
async function fetchServerPending(): Promise<PendingScan | null | "unknown"> {
  try {
    const res = await apiFetch("/api/trial/pending");
    if (!res.ok) return "unknown";
    const data = (await res.json()) as { pending?: PendingScan | null };
    return data.pending?.input?.cardName ? data.pending : null;
  } catch {
    return "unknown";
  }
}

/** Twice, so a blip cannot leave a copy behind that a second browser would add again. */
async function dropServerPending(): Promise<void> {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await apiFetch("/api/trial/pending", { method: "DELETE" });
      if (res.ok || res.status === 401) return;
    } catch {
      // try once more
    }
  }
}

function clearLocalPending(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
    localStorage.removeItem(PUSHED_KEY);
  } catch {
    // Already saved; a second claim would add a twin, but storage that can't remove can't read either.
  }
}

/**
 * After signup, on the scanner: the waiting card becomes an Inventory row.
 * Once this browser's card was parked on the server, the server copy is the
 * truth: the confirm link may have opened another browser that already saved
 * it, and then there is nothing left to add here. Otherwise this browser's copy,
 * else the server's (signed up in another browser, like TikTok's). Kept until
 * the save lands (a not-yet-confirmed inbox gets a 403 here, and the next visit
 * tries again). Once it lands BOTH copies are cleared, so a card is never added
 * twice. Returns the card's name when one was saved.
 */
export async function claimPendingScan(): Promise<string | null> {
  const local = readLocalPending();
  let pushed = false;
  try {
    pushed = localStorage.getItem(PUSHED_KEY) === "1";
  } catch {
    pushed = false;
  }
  let pending: PendingScan | null;
  if (local && !pushed) {
    pending = local;
  } else {
    const parked = await fetchServerPending();
    if (parked === "unknown") return null; // could not ask: try again next visit, never guess
    if (!parked && local && pushed) {
      // Saved from the other browser already (or the server lost it): never add it again here.
      clearLocalPending();
      return null;
    }
    pending = parked;
  }
  if (!pending) return null;
  const server = await createServerCard(pending.input);
  if (!server) return null;
  clearLocalPending();
  await dropServerPending();
  if (pending.photo) {
    const blob = await fetch(pending.photo).then((r) => r.blob()).catch(() => null);
    if (blob) void uploadCardPhoto(server.id, new File([blob], "scan.jpg", { type: blob.type || "image/jpeg" }));
  }
  return pending.input.cardName;
}
