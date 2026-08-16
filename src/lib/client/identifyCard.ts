"use client";

import { scanCard } from "@/lib/ocr";
import { searchCards } from "@/lib/cards";
import { scanCardWithVision } from "@/lib/client/visionApi";
import { isSecretRareNumber, type PrintedNumber } from "@/lib/cardNumber";
import type { ArtStyle, GameId, PokemonCard, ScanLanguage } from "@/lib/types";

export interface IdentifyResult {
  cards: PokemonCard[];
  /** Language the card actually identified in — the photo outranks the toggle. */
  language: ScanLanguage;
  error: string | null;
}

/**
 * The scanner's identification pipeline — vision first, OCR fallback, then the
 * candidate walk with its exact-name early exit — without the scanner's queue
 * state or its draft-card write. Exists for flows like the wishlist, where a
 * picture of a card someone *wants* shouldn't land in their seller ledger.
 */
export async function identifyCardImage(
  file: File,
  language: ScanLanguage,
  game: GameId = "pokemon",
): Promise<IdentifyResult> {
  try {
    const vision = await scanCardWithVision(file, language, game);

    let nameCandidates: string[];
    let printed: PrintedNumber | null;
    let art: ArtStyle = null;

    if (vision.status === "done" && vision.read) {
      const read = vision.read;
      language = read.language;
      art = read.artStyle ?? null;
      nameCandidates = [read.name, read.englishName].filter(
        (n): n is string => Boolean(n),
      );
      printed = read.cardNumber
        ? {
            number: read.cardNumber,
            setTotal: read.setTotal,
            setCode: read.setCode,
            isSecretRare: isSecretRareNumber(read.cardNumber, read.setTotal),
          }
        : null;
    } else {
      const scan = await scanCard(file, language);
      nameCandidates = scan.nameCandidates;
      printed = scan.printed;
    }

    let matches: PokemonCard[] = [];
    let lookupErrors = 0;

    // Substring hits are only a fallback — OCR debris can "match" dozens of
    // unrelated cards while the exact name sits later in the candidate list.
    for (const candidate of nameCandidates) {
      try {
        const found = await searchCards(candidate, printed, language, undefined, game, art);
        if (found.length === 0) continue;
        if (matches.length === 0) matches = found;
        if (
          found[0].name.trim().toLowerCase() === candidate.trim().toLowerCase()
        ) {
          matches = found;
          break;
        }
      } catch {
        lookupErrors++;
      }
    }

    // Glare on the name band: the printed fraction alone can still identify it
    // (Pokémon: number + set total; MTG: number + set code).
    const numbersIdentify =
      game === "mtg" ? Boolean(printed?.setCode) : Boolean(printed?.setTotal) && language === "en";
    if (matches.length === 0 && printed && numbersIdentify) {
      try {
        matches = await searchCards("", printed, language, undefined, game);
      } catch {
        lookupErrors++;
      }
    }

    if (
      matches.length === 0 &&
      lookupErrors > 0 &&
      lookupErrors >= nameCandidates.length
    ) {
      return {
        cards: [],
        language,
        error: "Card lookup is down right now — try searching by name instead",
      };
    }
    if (matches.length === 0) {
      return {
        cards: [],
        language,
        error: "Couldn't identify that image — try searching by name",
      };
    }
    return { cards: matches, language, error: null };
  } catch {
    return {
      cards: [],
      language,
      error: "Couldn't read that image — try a clearer picture of the card",
    };
  }
}
