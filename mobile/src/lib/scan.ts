/**
 * The scanner's brain in the app (docs/APP-PLAN.md step 4): the same steps
 * the website's scanner takes (src/app/app/page.tsx, pump()), with the same
 * rules. One read of the photo by /api/vision/scan (the server's 8 s budget,
 * lib/visionBudget.ts); the read turned into search clues; the catalog asked
 * through the site's own lib/cards.ts; the pick saved to the account at the
 * site's own quick-sale price. No OCR fallback, no auto-switch to another
 * game, slabs / tokens / art cards refused, a miss is given back, the copy
 * starts Near Mint (the photo's grade is a hint only, Chris 10-21).
 *
 * Not here yet: the Opus picture tiebreak on a near tie (lib/tiebreak.ts
 * reads src/data, which Metro does not serve): the ranker's #1 stands and
 * "Not this card?" lists the rest.
 */
import { fetchCardById, searchCards } from "@/lib/cards";
import { isSecretRareNumber, normalizeNumber, readHasPrintedKey, type PrintedNumber } from "@/lib/cardNumber";
import { patternPrintingFor } from "@/lib/foilPattern";
import { GAMES, isGameId } from "@/lib/games";
import { GRADED_LOCKED } from "@/lib/grading";
import { CONDITIONS, isFirstEditionCard, marketForCondition, pickPrice, priceFlagOf, quotePrice, tcgPriceOf } from "@/lib/listing";
import { formatMoney } from "@/lib/money";
import { mtgCuesOf } from "@/lib/mtgCues";
import { ONE_PIECE_DON_SET, isOnePieceSideline, printingChoices } from "@/lib/onepiece";
import { PRICE_FLAG_NOTE } from "@/lib/priceFlag";
import type { ScanQuota } from "@/lib/quotaTypes";
import { LOW_CONFIDENCE, UNREADABLE_CONFIDENCE, type ArtStyle, type Condition, type GameId, type MtgCues, type PokemonCard, type ScanLanguage, type VisionCardRead } from "@/lib/types";
import { foilChoices } from "@/lib/yugioh";
import { api, ApiError } from "./api";

export { CONDITIONS };
export type { Condition, PokemonCard, ScanQuota, VisionCardRead };

/** Same locks as the website's scanner page. */
const ART_CARDS_LOCKED = true;
const SLAB_MESSAGE = "That's a graded slab — graded cards aren't accepted yet. Scan a raw card";
const RETAKE_MESSAGE = "Couldn't read this card — retake with the whole card in the guide and no glare";

/** Long edge the photo is shrunk to before upload (the site's lib/client/visionApi.ts: legible, few image tokens). */
export const MAX_EDGE = 1024;
/** Magic reads more small print (The List icon, artist, year): the largest edge the API keeps. */
export const MAX_EDGE_MTG = 1568;
export function maxEdgeFor(game: GameId): number {
  return game === "mtg" ? MAX_EDGE_MTG : MAX_EDGE;
}

// ---------------------------------------------------------------- the read

export interface ReadOutcome {
  status: "done" | "quota" | "error" | "unconfigured";
  read: VisionCardRead | null;
  /** The balance after this scan, when the server sent it. */
  usage: ScanQuota | null;
  /** The server's own words on a quota (402) refusal, or a network failure. */
  error: string | null;
  /** The server ran out of its read budget (504). */
  timedOut?: boolean;
  /** A 429: the burst limiter or the daily budget. */
  rateLimited?: { seconds: number | null; daily: boolean };
  /** The scan_usage row: names the scan when a miss gives it back. */
  scanId: string | null;
}

/** POST /api/vision/scan with the bearer session. Never throws. */
export async function readPhoto(base64: string, game: GameId, language: ScanLanguage = "en"): Promise<ReadOutcome> {
  const empty = { read: null, usage: null, error: null, scanId: null } as const;
  try {
    const data = await api<{ status?: string; card?: VisionCardRead | null; usage?: ScanQuota | null; scanId?: unknown }>("/api/vision/scan", {
      body: { image: base64, mediaType: "image/jpeg", language, game },
      // The server answers inside its 8 s budget; the site's watchdog gives up at 20 s.
      timeoutS: 20,
    });
    return {
      status: data.status === "unconfigured" ? "unconfigured" : data.status === "done" && data.card ? "done" : "error",
      read: data.card ?? null,
      usage: data.usage ?? null,
      error: null,
      scanId: typeof data.scanId === "string" ? data.scanId : null,
    };
  } catch (err) {
    if (!(err instanceof ApiError)) return { status: "error", ...empty };
    const b = err.body;
    // 402 = no scans left (the message names a Booster / the plan); a 403 verifyEmail reads the same way.
    if ((err.status === 402 && b.quota) || (err.status === 403 && b.verifyEmail)) {
      return { status: "quota", read: null, usage: (b.usage as ScanQuota | undefined) ?? null, error: err.message, scanId: null };
    }
    if (err.status === 429) {
      const s = Number(b.retryAfterSeconds);
      const seconds = Number.isFinite(s) && s > 0 ? s : null;
      const daily = (seconds != null && seconds >= 600) || /budget|tomorrow|daily/i.test(err.message);
      return { status: "error", ...empty, rateLimited: { seconds, daily } };
    }
    if (err.status === 504) return { status: "error", ...empty, timedOut: true };
    // 422 blurry: refused before any paid call; the server's words are the retake message.
    if (err.status === 422 && err.body.reason === "blurry") return { status: "error", ...empty, error: err.message };
    // 0 = no connection / the app's own 20 s clock: say so in the server's absence.
    if (err.status === 0) return { status: "error", ...empty, error: err.message };
    return { status: "error", ...empty };
  }
}

/**
 * The free first scan before any account: POST /api/vision/trial (the ad
 * landing page's read, a few tries per device and per network, no bearer).
 * Same answer shape as readPhoto; a used-up device reads as "quota" with the
 * sign-up as the way to more scans. Never throws.
 */
export async function readPhotoGuest(base64: string, game: GameId): Promise<ReadOutcome> {
  const empty = { read: null, usage: null, error: null, scanId: null } as const;
  try {
    const data = await api<{ status?: string; card?: VisionCardRead | null }>("/api/vision/trial", {
      body: { image: base64, mediaType: "image/jpeg", game },
      timeoutS: 30,
    });
    return {
      status: data.status === "unconfigured" ? "unconfigured" : data.status === "done" && data.card ? "done" : "error",
      read: data.card ?? null,
      usage: null,
      error: null,
      scanId: null,
    };
  } catch (err) {
    if (!(err instanceof ApiError)) return { status: "error", ...empty };
    if (err.status === 402) return { status: "quota", ...empty, error: "Your free scan is used up. Sign up for 5 more." };
    if (err.status === 429) {
      const s = Number(err.body.retryAfterSeconds);
      const seconds = Number.isFinite(s) && s > 0 ? s : null;
      return { status: "error", ...empty, rateLimited: { seconds, daily: err.body.status === "busy" || (seconds != null && seconds >= 600) } };
    }
    if (err.status === 504) return { status: "error", ...empty, timedOut: true };
    if (err.status === 422 && err.body.reason === "blurry") return { status: "error", ...empty, error: err.message };
    if (err.status === 0) return { status: "error", ...empty, error: err.message };
    return { status: "error", ...empty };
  }
}

/** The words for a read that produced nothing (the site's lib/client/visionApi.ts rateLimitMessage). */
export function readFailureMessage(r: ReadOutcome): string {
  if (r.status === "quota") return r.error ?? "You're out of scans.";
  if (r.rateLimited) {
    if (r.rateLimited.daily) return "Daily limit reached — try again tomorrow";
    const s = r.rateLimited.seconds;
    return s != null && s > 0 && s <= 120 ? `Too many scans at once — wait ${s} seconds, then tap Capture again` : "Too many scans at once — wait a few seconds, then tap Capture again";
  }
  if (r.timedOut) return "Took too long — tap Capture again";
  if (r.error) return r.error;
  return "Couldn't read this card — tap Capture again";
}

/** A scan that found no card is given back (Chris 10-11). The server re-checks the read; null = nothing changed. */
export async function giveBackScan(scanId: string): Promise<ScanQuota | null> {
  try {
    const data = await api<{ refunded?: boolean; usage?: ScanQuota }>("/api/vision/scan/giveback", { body: { scanId } });
    return data.refunded === true && data.usage ? data.usage : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ the decision

export interface Identified {
  /** The pick, or null on a miss. */
  card: PokemonCard | null;
  /** Every printing the catalog offered, #1 first ("Not this card?"). */
  candidates: PokemonCard[];
  /** Why the seller should look before trusting the pick (the site's matchDoubt), or null = Ready. */
  doubt: string | null;
  /** The words for a miss. */
  error: string | null;
  /** The photo is another game's card: offer the switch (the read is reused, no second scan). */
  wrongGame: GameId | null;
  /** The printing the read picked (Magic finish, Pokémon pattern ball), or null for the default line. */
  variant: string | null;
  firstEdition: boolean;
  /** The card's own language, read off the photo (outranks the toggle). */
  language: ScanLanguage;
  /** Every lookup failed: the catalog is down, not the photo. */
  lookupDown: boolean;
}

function miss(error: string, extra: Partial<Identified> = {}): Identified {
  return { card: null, candidates: [], doubt: null, error, wrongGame: null, variant: null, firstEdition: false, language: "en", lookupDown: false, ...extra };
}

/**
 * The read turned into a catalog match, exactly as the website's scanner
 * page does it (page.tsx, from `if (vision.status === "done")` through the
 * `patchItem({ status: ... })` that shows the card). `reuseAs` = a "Switch to
 * <game>" tap: the same read is matched under the other game.
 */
export async function identify(read: VisionCardRead, game: GameId): Promise<Identified> {
  const language = read.language;
  let art: ArtStyle = read.artStyle ?? null;
  const cues: MtgCues | null = game === "mtg" ? mtgCuesOf(read) : null;
  let nameCandidates = [read.name, read.englishName].filter((n): n is string => Boolean(n));
  let printed: PrintedNumber | null = readHasPrintedKey(read, game)
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
  let artOnly = false;
  let artMiss: string | null = null;

  // Reads that must not become a guess (the site's order, word for word).
  const otherGame = read.detectedGame && read.detectedGame !== game && read.detectedGame !== "other" ? read.detectedGame : null;
  if (otherGame) {
    if (isGameId(otherGame)) return miss(`That looks like a ${GAMES[otherGame].label} card`, { wrongGame: otherGame, language });
    return miss(`That looks like a ${otherGame} card — CardFlip doesn't scan those yet`, { language });
  }
  if (typeof read.confidence === "number" && read.confidence < UNREADABLE_CONFIDENCE && read.kind !== "art") return miss(RETAKE_MESSAGE, { language });
  if (read.slab && GRADED_LOCKED) return miss(read.name?.trim() ? SLAB_MESSAGE : RETAKE_MESSAGE, { language });
  if (game === "mtg" && (read.kind === "token" || (read.cardNumber && /^T\s*\d+$/i.test(read.cardNumber.trim())))) {
    return miss("That's a token — tokens aren't accepted. Scan a playable card", { language });
  }
  if (game === "mtg" && read.kind === "art" && ART_CARDS_LOCKED) return miss("That's an art card — art cards aren't accepted. Scan a playable card", { language });
  if (game === "mtg" && read.kind === "art") {
    artOnly = true;
    art = "full-art";
    artMiss = "Art card — couldn't read the name along the bottom edge. Retake closer, sharp, no glare";
    if (printed) {
      const code = (printed.setCode ?? "").toUpperCase();
      if (code && !code.startsWith("A")) printed = { ...printed, setCode: `A${code}` };
    }
  }

  // The catalog: an exact name ends the walk; substring hits are a fallback only.
  let matches: PokemonCard[] = [];
  let lookupErrors = 0;
  let searchLimited = false;
  for (const candidate of nameCandidates) {
    try {
      const found = await searchCards(candidate, printed, language, undefined, game, art, artOnly, read.firstEdition ?? null, cues);
      if (found.length === 0) continue;
      if (matches.length === 0) matches = found;
      if (found[0].name.trim().toLowerCase() === candidate.trim().toLowerCase()) {
        matches = found;
        break;
      }
    } catch (err) {
      lookupErrors++;
      if (String(err).includes("(429)")) searchLimited = true;
    }
  }
  // Every name missed but the fraction can identify the card alone (glare on the name).
  const numbersIdentify = game === "mtg" ? Boolean(printed?.setCode) : Boolean(printed?.number && printed?.setTotal) && language === "en";
  if (matches.length === 0 && printed && numbersIdentify) {
    try {
      matches = await searchCards("", printed, language, undefined, game, null, false, read.firstEdition ?? null, cues);
    } catch (err) {
      lookupErrors++;
      if (String(err).includes("(429)")) searchLimited = true;
    }
  }

  if (matches.length === 0 && lookupErrors > 0 && lookupErrors >= nameCandidates.length) {
    return miss(searchLimited ? "Too many lookups at once — wait a few seconds, then tap Scan again" : "Card lookup is down right now — search by name to add it", { language, lookupDown: true });
  }
  if (matches.length === 0) return miss(artMiss ?? "No match found — search by name to add it", { language });

  let card = matches[0];
  // A match that arrived without its price (10-29 11:10pm, Chris's first real-build scan: Maractus Black Bolt 093 read
  // "price looks off" while the guard said nothing and $6.52 was held): ask for the card by id, the way the website holds
  // "pricing…" until the point lands, before the reveal prints "no price yet".
  if (!hasUsdPrice(card)) {
    const priced = await repriceById(card.id, game);
    if (priced) {
      card = priced;
      matches = matches.map((m) => (m.id === priced.id ? priced : m));
    }
  }
  const lowConfidence = typeof read.confidence === "number" && read.confidence < LOW_CONFIDENCE;
  const numberPinned = Boolean(printed?.number) && normalizeNumber(card.number) === normalizeNumber(printed!.number);
  const ambiguous = matches.length > 1 && !numberPinned;
  const numberMismatch = Boolean(printed?.number) && !numberPinned;
  const foils =
    game === "yugioh"
      ? foilChoices(card, matches).length
      : game === "onepiece"
        ? printingChoices(card, matches).filter((c) => c.id === card.id || isOnePieceSideline(card) || !isOnePieceSideline(c)).length
        : 0;
  const foreignPrint = (game === "onepiece" || game === "lorcana" || game === "yugioh") && language !== "en";
  const pricedVariants = card.prices.filter((p) => p.currency === "USD" && p.market != null && p.market > 0).map((p) => p.variant);
  const variant =
    cues?.finish && (card.finishes ?? []).includes(cues.finish)
      ? cues.finish
      : game === "pokemon" && !isFirstEditionCard(card)
        ? patternPrintingFor(read, pricedVariants)
        : null;
  const doubt = lowConfidence
    ? "Low-confidence read — check it's the right card"
    : numberMismatch
      ? `Read #${printed!.number}, closest printing is #${card.number}`
      : game === "onepiece" && card.setCode === ONE_PIECE_DON_SET
        ? "DON!! card, pick yours: search DON plus the character or set"
        : ambiguous
          ? `${matches.length} printings matched, no number read`
          : foreignPrint
            ? `${language === "ja" ? "Japanese" : "Chinese"} card, the price shown is for the English print`
            : foils > 1
              ? `Comes in ${foils} foils, pick yours`
              : game === "pokemon" &&
                  (read.foilPattern === "reverse" || (read.foilPattern == null && read.patternLook != null)) &&
                  pricedVariants.filter((v) => /BallPattern$/.test(v)).length >= 2
                ? "Reverse holo: tilt it to see the ball, then pick Poké Ball or Master Ball"
                : null;
  return { card, candidates: matches, doubt, error: null, wrongGame: null, variant, firstEdition: isFirstEditionCard(card), language, lookupDown: false };
}

// ---------------------------------------------------------------- the price

/** A USD row the reveal can print: a market number, or a guard flag (its fallback / note speak). */
const hasUsdPrice = (c: PokemonCard): boolean => c.prices.some((p) => p.currency === "USD" && ((p.market != null && p.market > 0) || p.untrusted != null));

/** Two more reads of the card by id, 1.2 s apart, for a match the search answered before its price was in. */
async function repriceById(id: string, game: GameId): Promise<PokemonCard | null> {
  for (let i = 0; i < 2; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const c = await fetchCardById(id, game);
      if (c && hasUsdPrice(c)) return c;
    } catch {
      // The reveal prints "no price yet"; the row prices itself once the site has the number (collection.ts).
    }
  }
  return null;
}

export interface RevealPrice {
  /** "$12.34", or null when there is no number to show (then `note` says why). */
  text: string | null;
  /** Which line it is ("Holofoil", "Near Mint"). */
  label: string;
  note: string | null;
}

/** The price line a card shows when the read picked none (the website's pickPrice). */
export function defaultVariantOf(card: PokemonCard): string | null {
  return pickPrice(card)?.variant ?? null;
}

/** The headline the scanner shows: the website's headlinePrice (TCG market for this copy's condition). */
export function revealPrice(card: PokemonCard, condition: Condition, variant: string | null): RevealPrice {
  const override = variant ?? undefined;
  const label = (override && card.prices.find((p) => p.variant === override)?.label) || pickPrice(card)?.label || "Market";
  const flag = priceFlagOf(card, override);
  if (flag) {
    return typeof flag.fallback === "number" && flag.fallback > 0
      ? { text: formatMoney(marketForCondition(flag.fallback, condition), "USD"), label, note: PRICE_FLAG_NOTE }
      : { text: null, label, note: PRICE_FLAG_NOTE };
  }
  const market = tcgPriceOf(card, override);
  if (market != null && market > 0) return { text: formatMoney(marketForCondition(market, condition), "USD"), label, note: null };
  const quote = quotePrice(card, condition, "market", override);
  if (quote && quote.suggested > 0) return { text: formatMoney(quote.suggested, "USD"), label, note: null };
  return { text: null, label, note: "No market price yet" };
}

// ----------------------------------------------------------------- the save

export interface SavedCard {
  id: string;
}

/** POST /api/cards as the website's scanner does on a match (quick-sale asking price, market kept beside it). */
export async function saveScan(card: PokemonCard, game: GameId, condition: Condition, variant: string | null, scanId: string | null): Promise<SavedCard | null> {
  const override = variant ?? undefined;
  const market = revealPrice(card, condition, variant);
  const input = {
    cardName: card.englishName || card.name,
    setName: card.setName,
    cardNumber: card.number,
    imageUrl: card.imageSmall,
    condition,
    price: quotePrice(card, condition, "quick", override)?.suggested ?? 0,
    scanPrice: quotePrice(card, condition, "market", override)?.suggested ?? null,
    scanMarket: market.text && !market.note ? Number(market.text.replace(/[^0-9.]/g, "")) || null : null,
    game,
    catalogCardId: card.id || null,
    rarity: card.rarity ?? null,
    category: null,
    packId: null,
    variant,
    // Same id on the retry: a first POST that landed but timed out must not leave a twin row (10-22).
    clientId: scanId ?? `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  const once = async () => {
    try {
      const { card: saved } = await api<{ card?: { id: string } | null }>("/api/cards", { body: input, timeoutS: 15 });
      return saved?.id ? { id: saved.id } : null;
    } catch {
      return null;
    }
  };
  const saved = (await once()) ?? (await once());
  // The "-1st" twin is sold as a 1st Edition copy: the create route has no such field, the site patches it too.
  if (saved && isFirstEditionCard(card)) void api(`/api/cards/${saved.id}`, { method: "PATCH", body: { firstEdition: true } }).catch(() => undefined);
  return saved;
}

/** "Not this card?": the saved row becomes the printing the seller picked (no new scan). */
export async function swapSavedCard(id: string, card: PokemonCard, condition: Condition, variant: string | null): Promise<boolean> {
  const override = variant ?? undefined;
  const market = revealPrice(card, condition, variant);
  try {
    await api(`/api/cards/${id}`, {
      method: "PATCH",
      body: {
        cardName: card.englishName || card.name,
        setName: card.setName,
        cardNumber: card.number,
        imageUrl: card.imageSmall,
        catalogCardId: card.id || null,
        rarity: card.rarity ?? null,
        firstEdition: isFirstEditionCard(card),
        variant,
        price: quotePrice(card, condition, "quick", override)?.suggested ?? 0,
        scanMarket: market.text && !market.note ? Number(market.text.replace(/[^0-9.]/g, "")) || null : null,
        // No verifiedAt: a pick is a correction, not a verification; the site's swapCard leaves the row
        // unverified and the queue's Verify is still the person's call (Chris 10-29 5:44pm: "any card picked
        // is auto verified … without actually pressing it").
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** The copy's condition / printing after the reveal (the site's "This copy" sheet). */
export async function updateSavedCard(id: string, card: PokemonCard, condition: Condition, variant: string | null): Promise<boolean> {
  const override = variant ?? undefined;
  try {
    await api(`/api/cards/${id}`, {
      method: "PATCH",
      body: {
        condition,
        variant,
        price: quotePrice(card, condition, "quick", override)?.suggested ?? 0,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** "Remove": the row goes, like the website's take-off-list. */
export async function removeSavedCard(id: string): Promise<boolean> {
  try {
    await api(`/api/cards/${id}`, { method: "DELETE" });
    return true;
  } catch (err) {
    return err instanceof ApiError && err.status === 404;
  }
}

/** Printings a seller can pick between after the reveal: the candidates, the pick first, no "-1st" twins of it. */
export function printingOptions(pick: PokemonCard, candidates: PokemonCard[]): PokemonCard[] {
  const seen = new Set<string>();
  const out: PokemonCard[] = [];
  for (const c of [pick, ...candidates]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out.slice(0, 12);
}
