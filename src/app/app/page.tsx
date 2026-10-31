"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { lastRecordedPoint } from "@/lib/client/priceHistoryData";
import Link from "next/link";
import PhoneHint from "@/components/PhoneHint";
import { useRouter } from "next/navigation";
import Uploader from "@/components/Uploader";
import GameToggle from "@/components/GameToggle";
import PricingModeToggle from "@/components/PricingModeToggle";
import type { ShowcaseCard } from "@/components/Uploader";
import CameraCapture from "@/components/CameraCaptureLazy";
import { postToApp } from "@/lib/appMode";
import StagedProgress from "@/components/StagedProgress";
import QueueRow from "@/components/QueueRow";
import ShareImageButton from "@/components/ShareImageButton";
import { cardKey } from "@/lib/cardPages";
import CardEditor from "@/components/CardEditor";
import SealedEditor from "@/components/SealedEditor";
import PageSkeleton from "@/components/PageSkeleton";
import { useSession } from "@/components/SessionProvider";
/**
 * An item still "scanning" this long is failed by the watchdog, whatever it is waiting on (10-04). Above the scan
 * request's own 30 s limit (lib/client/visionApi.ts), so a slow upload ends as that request's answer, not here.
 */
const SCAN_WATCHDOG_MS = 35_000;

/**
 * "?scan=1" asked for the scanner (the /scan ad signup, the email confirm link). Kept outside the component
 * so it survives the page being mounted again right after arrival (A36, 10-15: a brand-new account landed
 * on /app?scan=1 with the scanner closed); cleared when the scanner closes.
 */
let scanOpenPending = false;

/**
 * An in-app jump (router.push from /signup) renders this page while the address bar still shows the page it
 * came from, so window.location has no "?scan=1" yet (A36 10-15: the ad signup landed with the scanner shut).
 * The signup page leaves this one-time note first (OPEN_SCAN_NOTE in lib/client/scanPrefs).
 */
function readOpenScanNote(): boolean {
  try {
    return sessionStorage.getItem(OPEN_SCAN_NOTE) === "1";
  } catch {
    return false;
  }
}
function clearOpenScanNote(): void {
  try {
    sessionStorage.removeItem(OPEN_SCAN_NOTE);
  } catch {
    // nothing stored
  }
}
import { fetchCardById, searchCards } from "@/lib/cards";
import { mtgCuesOf } from "@/lib/mtgCues";
import { patternPrintingFor } from "@/lib/foilPattern";
import { isSecretRareNumber, normalizeNumber, pickPrinting, readHasPrintedKey, type PrintedNumber } from "@/lib/cardNumber";
import { buildListing, buildSealedListing, canBeFirstEdition, isFirstEditionCard, itemFirstEdition, withListingOverrides, currentPrice, headlinePrice, describeItemCondition, effectiveVariant, formatMoney, mtgFinishOf, quotePrice, withEbayPrices, quoteForItem, CONDITIONS } from "@/lib/listing";
import { GRADED_LOCKED, parseGradeQuery } from "@/lib/grading";
import { GAMES, isGameId, parseGame, readSavedGame, saveGame } from "@/lib/games";
import { TAP_8 } from "@/lib/tap";
import { OPEN_SCAN_NOTE, readActivePackId, readSavedCategory, readSavedCondition, readSavedStrategy, saveCategory } from "@/lib/client/scanPrefs";
import CategorySheet, { distinctCategories } from "@/components/CategorySheet";
import { resolveCategory } from "@/lib/categories";
import ActivePackBar from "@/components/ActivePackBar";
import {
  createServerCard,
  type ServerCard,
  deleteServerCard,
  fetchServerCards,
  fetchCategories,
  reportSaveFailed,
  updateServerCard,
} from "@/lib/client/cardsApi";
import { toast } from "@/components/Toaster";
import { confirmAction } from "@/components/ConfirmDialog";
import { apiPath } from "@/lib/client/basePath";
import { EBAY_DRAFTS_URL, fetchEbayComps, sendEbayDraft } from "@/lib/client/ebayApi";
import { uploadCardPhoto } from "@/lib/client/cardPhotoApi";
import { giveBackScan, rateLimitMessage, scanCardWithVision, tiebreakCard, type ScanUsage, type VisionScanOutcome } from "@/lib/client/visionApi";
import { tiebreakIds } from "@/lib/tiebreak";
import { claimPendingScan } from "@/lib/client/trialScan";
import { foilChoices } from "@/lib/yugioh";
import { isOnePieceSideline, ONE_PIECE_DON_SET, printingChoices } from "@/lib/onepiece";
import { LOW_CONFIDENCE, UNREADABLE_CONFIDENCE } from "@/lib/types";
import type {
  ArtStyle,
  MtgCues,
  Condition,
  GameId,
  PokemonCard,
  ScanItem,
  ScanLanguage,
} from "@/lib/types";

/** Vision returns a condition string; only accept one the pricing model knows. */
function asCondition(value: string | null): Condition | null {
  return value && (CONDITIONS as string[]).includes(value)
    ? (value as Condition)
    : null;
}

function createItem(file: File | null, language: ScanLanguage, game: GameId): ScanItem {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "card",
    game,
    serverId: null,
    file,
    previewUrl: file ? URL.createObjectURL(file) : "",
    language,
    status: "queued",
    candidates: [],
    card: null,
    // Last-used picks, remembered per browser (scanPrefs) — a seller working
    // a Lightly Played box or always selling at market shouldn't re-pick per
    // card. Vision's read of the photo still overwrites the condition.
    condition: readSavedCondition(),
    strategy: readSavedStrategy(),
    variant: null,
    firstEdition: false,
    grading: null,
    productType: null,
    priceOverride: null,
    costBasis: null,
    titleOverride: null,
    descriptionOverride: null,
    vision: null,
    visionStatus: "idle",
    ebay: null,
    ebayStatus: "idle",
    ebaySold: null,
    ebaySoldStatus: "unavailable",
    ebaySoldUrl: null,
    ebayOfferId: null,
    ebayListingUrl: null,
    ebayDraftUrl: null,
    photoAt: null,
    error: null,
    listedPrice: null,
    listedAt: null,
    soldPrice: null,
    soldAt: null,
    verifiedAt: null,
    matchDoubt: null,
    // Left undefined on purpose: "not fetched yet" (the reveal chip waits
    // for it); loadCurrentPoint sets the point or null.
  };
}

/** One ledger row back into the editor, exactly as the single-card resume built it. */
function buildResumed(row: ServerCard, game: GameId, results: PokemonCard[], card: PokemonCard): ScanItem {
    // A slab's ledger condition IS its grade ("PSA 10", synced live by the
    // editor) — parse it back so the card resumes as the slab it is.
    const { grading } = parseGradeQuery(row.condition);
    const item: ScanItem = {
  ...createItem(null, "en", game),
  // The stored scan photo — it IS the eBay listing image, so the
  // "Your photo" panel must show it beside the match on resume.
  previewUrl: row.photoAt ? apiPath(`/api/card-image/${row.id}?v=${row.photoAt}`) : "",
  status: row.status === "listed" ? "listed" : "ready",
  serverId: row.id,
  costBasis: row.costBasis,
  candidates: results,
  card,
  grading,
  firstEdition: row.firstEdition,
  variant: row.variant ?? null,
  shipping: row.shippingMethod ?? null,
  // Slabs price off raw market as a floor, never quick-sale discounts.
  strategy: grading ? "market" : "quick",
  condition: asCondition(row.condition) ?? "Near Mint",
  priceOverride: row.price > 0 ? row.price : null,
  quantity: row.quantity || 1,
  photoAt: row.photoAt,
  ebayOfferId: row.ebayOfferId,
  ebayListingUrl: row.status === "listed" ? row.ebayListingUrl : null,
  ebayDraftUrl: row.ebayDraftUrl,
  listedPrice: row.status === "listed" ? row.price : null,
  listedAt: row.listedAt,
  verifiedAt: row.verifiedAt ?? null,
  matchDoubt: row.matchDoubt ?? null,
    };
    return item;
}

/**
 * The ledger fields for an item whose card just changed (a "Not your card?" pick, a printing swap):
 * the new card's own quote, before its chart point or eBay comps land (those re-save it). Review
 * 10-20: TheJoseph's Angel #25 kept the D23 promo's $73.16 because nothing re-priced the row when he
 * switched back. A typed price stays; listed/sold rows keep the price they went out at.
 */
function ledgerPriceForNewCard(item: ScanItem): { price?: number; priceLocked: false } | null {
  if (item.priceOverride != null || item.language !== "en" || item.status === "listed" || item.status === "sold") return null;
  const quote = quoteForItem({ ...item, currentPoint: undefined });
  return { ...(quote ? { price: quote.suggested } : {}), priceLocked: false };
}

/** Concurrent scans per tab — see pumpingRef. */
const SCAN_WORKERS = 2;

/** A checkpoint write (verify, list, sold...): one retry, then say so (10-22: a dropped PATCH left the card unverified in silence). */
async function saveChange(id: string, patch: Parameters<typeof updateServerCard>[1]): Promise<void> {
  if ((await updateServerCard(id, patch)) || (await updateServerCard(id, patch))) return;
  toast("Couldn't save that change. Check your connection.", "err");
}
/** Art Series cards are refused at the scan (Chris 09-10), like tokens. */
const ART_CARDS_LOCKED = true;
/** Graded slabs refused at the scan while lib/grading GRADED_LOCKED is on (09-25). */
const SLAB_MESSAGE = "That's a graded slab — graded cards aren't accepted yet. Scan a raw card";

/* Reopen tracker: the ledger fetch and catalog match run in parallel and
   usually land inside two seconds; the last step holds until they do. */
const RESUME_STEPS = ["Finding the match", "Pulling today's prices", "Loading your photo"] as const;
const RESUME_STAGE_MS = [900, 2000] as const;

export default function AppPage() {
  const router = useRouter();
  const { user, refresh, patchUser } = useSession();
  // Out of scans blocks Capture and says so the moment the camera opens (Chris 10-12; no OCR fallback).
  const outOfScans = Boolean(user?.scans && user.scans.remaining != null && user.scans.remaining <= 0);
  const outOfScansRef = useRef(outOfScans);
  useEffect(() => {
    outOfScansRef.current = outOfScans;
  }, [outOfScans]);

  // The card scanned on the ad landing page before signup (/scan, 10-05) lands in Inventory now.
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    void claimPendingScan().then((name) => {
      if (name) toast(`${name} is saved in your Inventory`);
    });
  }, [userId]);

  const [items, setItems] = useState<ScanItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // English only (Chris 10-22: "we only want english"); the ja/zh pipeline underneath is unused.
  const language: ScanLanguage = "en";
  // Which game the scanner reads: Pokémon or Magic. Remembered per browser;
  // every item entering the queue carries the game it was scanned under, so
  // switching mid-session doesn't relabel what's already there.
  // The stage's real card (empty state only). One fetch, cached an hour
  // server-side; a miss just leaves the stage as the buttons.
  const [game, setGameState] = useState<GameId>(readSavedGame);
  // Follows the game switch (Chris 09-30): a One Piece card on the One Piece
  // stage, about $50. The payload remembers which game it was fetched for,
  // so the old game's card never sits under the new game's Scan button
  // while the new one loads (derived, not cleared in the effect — lint's
  // set-state-in-effect rule).
  const [stage, setStage] = useState<{ game: GameId; cards: ShowcaseCard[] }>({ game: "pokemon", cards: [] });
  const showcase = stage.game === game ? stage.cards : [];
  useEffect(() => {
    let cancelled = false;
    fetch(apiPath(`/api/cards/featured${game === "pokemon" ? "" : `?game=${game}`}`))
      .then((r) => (r.ok ? r.json() : { cards: [] }))
      .then((d) => {
        if (!cancelled) setStage({ game, cards: Array.isArray(d.cards) ? d.cards : [] });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [game]);
  const setGame = useCallback((next: GameId) => {
    setGameState(next);
    saveGame(next);
  }, []);
  // Lives here rather than in Uploader: the first capture swaps the page from
  // the hero layout to the queue layout, and the viewfinder must survive that.
  // ?scan=1 (10-05): the email confirm link lands here signed in, with the scanner already open.
  const [cameraOpen, setCameraOpen] = useState(() => {
    if (typeof window !== "undefined" && (new URLSearchParams(window.location.search).get("scan") === "1" || readOpenScanNote())) scanOpenPending = true;
    return scanOpenPending;
  });
  // The gate (SubscriptionGate) keeps the scanner page up while the camera is open OR cards are still in the queue
  // (10-08, Chris: the last free scan must still be verifiable), and shows the wall on the next visit to the Scanner.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("cardflip:camera", { detail: cameraOpen || items.length > 0 }));
  }, [cameraOpen, items.length]);
  useEffect(() => {
    clearOpenScanNote();
    if (new URLSearchParams(window.location.search).get("scan") === "1") window.history.replaceState(null, "", "/app");
  }, []);
  // Category new cards are filed under (Chris, 09-04): asked when the camera
  // opens, remembered per browser, rides on every createServerCard.
  // Per-account: the saved value is keyed by user id, so it reads null until
  // the session is known and null again after an account switch. Tracked as
  // { forUser, value } so the read happens during render, not in an effect.
  // Per game too (10-24, Chris): switching to Magic reads Magic's folder, never the Pokémon one.
  const [scanCategoryState, setScanCategoryState] = useState<{ forUser: string | null; forGame: GameId | null; value: string | null }>({ forUser: null, forGame: null, value: null });
  const scanCategory =
    scanCategoryState.forUser === (user?.id ?? null) && scanCategoryState.forGame === game ? scanCategoryState.value : readSavedCategory(user?.id, game);
  const setScanCategory = (value: string | null) => setScanCategoryState({ forUser: user?.id ?? null, forGame: game, value });
  const scanCategoryRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const gameRef = useRef<GameId>(game);
  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);
  useEffect(() => {
    gameRef.current = game;
  }, [game]);
  useEffect(() => {
    scanCategoryRef.current = scanCategory;
  }, [scanCategory]);
  const [categoryPrompt, setCategoryPrompt] = useState<{ existing: string[] } | null>(null);
  // The account's categories as last fetched, so an Auto pick reuses an existing spelling of a set.
  const knownCategoriesRef = useRef<string[]>([]);
  // Asked once per camera session, AFTER the first capture (Chris, 09-04:
  // "move it to after the picture is taken") — no gate before shooting.
  const categoryAskedRef = useRef(false);
  const sessionItemIdsRef = useRef<string[]>([]);
  // The item created by the camera's most recent capture, so the viewfinder
  // can show that scan's outcome live while the next card is lined up.
  const [cameraItemId, setCameraItemId] = useState<string | null>(null);
  // The eBay callback lands here with ?ebay=connected; show it once and
  // drop the param so a refresh doesn't repeat it. Read at first render (no
  // useSearchParams — that would force a Suspense boundary on the whole page).
  const [ebayJustConnected, setEbayJustConnected] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("ebay") === "connected",
  );
  useEffect(() => {
    if (ebayJustConnected) window.history.replaceState(null, "", "/app");
  }, [ebayJustConnected]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  // Items that failed the last bulk send, so "Retry failed (N)" can re-run
  // just those instead of making the seller hunt through the queue.
  const [bulkFailedIds, setBulkFailedIds] = useState<string[]>([]);
  // Scan-allowance metering, fed by each vision response. usage shows the
  // chip for subscribers (remaining is null when the cap isn't enforced);
  // quotaNote is the 402 banner, shown once until dismissed.
  const [scanUsage, setScanUsage] = useState<ScanUsage | null>(null);
  const [quotaNote, setQuotaNote] = useState<string | null>(null);
  const quotaNoteDismissed = useRef(false);

  // The pump loop reads and writes the queue outside of React's render cycle,
  // so the ref is the source of truth and state is kept in step with it.
  const itemsRef = useRef<ScanItem[]>([]);
  // Scans in flight. Vision is ~4s a card (Sonnet 5, measured median 09-02),
  // and one at a time made a stack feel like 4s × N (Chris, 09-03: "takes
  // like 5 seconds to identify"). Two workers halve the wait on a stack
  // without touching per-card accuracy; the vision route and the lookup
  // limiter both tolerate it.
  const pumpingRef = useRef(0);
  // Items with an eBay lookup in flight, so the effect that kicks them off
  // can't double-fire on a re-render before the status patch lands.
  const compsInFlight = useRef<Set<string>>(new Set());

  const commit = useCallback((next: ScanItem[]) => {
    itemsRef.current = next;
    setItems(next);
    // Every queue write lands in sessionStorage too, so a refresh can rebuild
    // the stack; an empty write naturally clears it.
  }, []);

  // Items the scan watchdog failed (see pump): later patches for them are dropped.
  const abandoned = useRef(new Set<string>());
  // The latest scan per item (a token object): its picture tiebreak is the only one that may settle printingCheck.
  const tieRuns = useRef(new Map<string, object>());
  const patchItem = useCallback(
    (id: string, patch: Partial<ScanItem>) => {
      // An item the watchdog gave up on keeps its error: a late result must not revive "scanning" or flip it to ready.
      if (abandoned.current.has(id)) return;
      // Taken off the list inside the Undo window: keep the snapshot current (a serverId or verify that lands now
      // would otherwise be lost when Undo puts the old copy back, 10-22).
      const removed = pendingRemovals.current.get(id);
      if (removed) {
        removed.item = { ...removed.item, ...patch };
        return;
      }
      commit(
        itemsRef.current.map((item) =>
          item.id === id
            ? {
                ...item,
                ...patch,
                // A printing pick (reverse holo, Poké Ball pattern, Magic foil) is a different eBay market: queue the
                // comps again for it (one Browse call, cached per printing for the day). A lookup already out re-queues
                // itself when it lands (loadEbayComps' finally), so a loading item is left alone here (10-22).
                ...("variant" in patch && item.card && (patch.variant ?? null) !== (item.variant ?? null) && item.ebayStatus !== "loading"
                  ? { ebayStatus: "idle" as const }
                  : {}),
              }
            : item,
        ),
      );

      // Ready/listed/sold are the checkpoints an admin actually cares about
      // seeing — field-by-field edits before that stay client-only until one
      // of those checkpoints is hit, so we're not round-tripping on keystroke.
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item?.serverId) return;

      if (patch.status === "listed") {
        void saveChange(item.serverId, {
          status: "listed",
          price: item.listedPrice ?? undefined,
          listedAt: item.listedAt,
          // Null for a fresh publish; carries the cleared sale fields when a
          // sold card is reverted to listed (SoldPanel's "not sold after all"),
          // so the ledger doesn't keep a ghost sale on a live listing.
          soldPrice: item.soldPrice,
          soldAt: item.soldAt,
          // Grading is chosen in the editor after the draft was created, so
          // the ledger's condition ("PSA 10", "Factory Sealed") syncs at the
          // checkpoint rather than at creation.
          condition: describeItemCondition(item),
        });
      } else if (patch.status === "sold") {
        void saveChange(item.serverId, {
          status: "sold",
          soldPrice: item.soldPrice,
          soldAt: item.soldAt,
          condition: describeItemCondition(item),
        });
      } else if (patch.status === "ready" && "listedAt" in patch) {
        void saveChange(item.serverId, { status: "ready", listedAt: null });
      }
      // Verification is its own checkpoint: it's what unlocks publishing,
      // and it has to outlive this tab (My Cards shows it).
      if ("verifiedAt" in patch || "matchDoubt" in patch) {
        void saveChange(item.serverId, {
          ...("verifiedAt" in patch ? { verifiedAt: patch.verifiedAt ?? null } : {}),
          ...("matchDoubt" in patch ? { matchDoubt: patch.matchDoubt ?? null } : {}),
        });
      }
      // The variant picker (Magic foil / etched, Pokémon holo) changes what
      // the card IS on eBay and which series prices it — sync it at once.
      if ("variant" in patch) {
        void saveChange(item.serverId, { variant: patch.variant ?? null, scanMarket: headlinePrice(item) || null });
      }
      if ("shipping" in patch) {
        void saveChange(item.serverId, { shippingMethod: patch.shipping ?? null });
      }
    },
    [commit],
  );

  /**
   * Swap an item's identity for another catalog card: the editor's "Not your
   * card?" pick, and (10-11) the picture tiebreak when it lands after the
   * card is already on screen. `doubt` is the Check-match line the seller
   * sees; a swap wipes verification, the price override and the eBay
   * lookups, and renames the ledger row when one exists.
   */
  const swapCard = useCallback(
    (id: string, card: PokemonCard, candidates: PokemonCard[], doubt?: string) => {
      const cur = itemsRef.current.find((i) => i.id === id);
      if (!cur?.card || cur.card.id === card.id) return;
      abandoned.current.delete(id);
      patchItem(id, {
        card,
        candidates: [card, ...candidates.filter((c) => c.id !== card.id)],
        status: "ready",
        verifiedAt: null,
        matchDoubt: (doubt ?? `corrected from ${cur.card.englishName || cur.card.name} (${cur.card.setName})`).slice(0, 80),
        priceOverride: null,
        variant: null,
        firstEdition: isFirstEditionCard(card),
        grading: null,
        error: null,
        currentPoint: undefined,
        // A pick settles the printing; the tiebreak's own swap marks it "done" right after.
        printingCheck: undefined,
        ebay: null,
        ebayStatus: "idle",
        ebaySold: null,
        ebaySoldStatus: "unavailable",
      });
      const next = itemsRef.current.find((i) => i.id === id);
      if (cur.serverId) {
        void updateServerCard(cur.serverId, {
          cardName: card.englishName || card.name,
          setName: card.setName,
          cardNumber: card.number,
          imageUrl: card.imageSmall,
          catalogCardId: card.id || null,
          rarity: card.rarity ?? null,
          firstEdition: isFirstEditionCard(card),
          ...(next ? ledgerPriceForNewCard(next) : null),
          // Packs count the market the scanner shows for the NEW card (10-20: a Charizard pull kept $122.30 after the $2.77 swap).
          scanMarket: next ? headlinePrice(next) || null : null,
        });
      }
    },
    [patchItem],
  );

  // Fresh scanner every visit (Chris, 08-27: "i want fresh starts"). The
  // queue used to rebuild itself from the saved snapshot after a refresh,
  // re-opening the previous session's cards every time the app opened. The
  // ledger (collection page) already keeps every card that reached the
  // server, so nothing is lost by starting empty -- the snapshot is cleared
  // on arrival so there is never anything to restore.
  // Release the object URLs held by previews when the page goes away.
  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  const pump = useCallback(async () => {
    if (pumpingRef.current >= SCAN_WORKERS) return;
    pumpingRef.current++;
    // Set by the watchdog when it hands this worker's slot to a fresh pump() (review 10-19 #5).
    let freed = false;

    try {
      for (;;) {
        // A worker whose slot the watchdog handed on finishes its own (rescued) row and stops: an early `continue`
        // below must not let it pick up another item beside the fresh worker.
        if (freed) return;
        const queued = itemsRef.current.find((i) => i.status === "queued");
        if (!queued) break;

        // Search-added items are born "ready" and never enter the queue; a
        // queued item without a file would otherwise loop here forever.
        if (!queued.file) {
          patchItem(queued.id, { status: "error", error: "No photo attached" });
          continue;
        }
        const next: ScanItem & { file: File } = { ...queued, file: queued.file };

        patchItem(next.id, { status: "scanning" });
        // More waiting and a free worker slot: run them side by side. The
        // claim above is synchronous (commit writes itemsRef), so two
        // workers can never pick the same item.
        if (itemsRef.current.some((i) => i.status === "queued")) void pump();

        // The watchdog (Chris 10-04: "stalling in general is really bad"): whatever the code below is waiting on,
        // an item still "scanning" at the limit is failed, and anything that lands for it later is ignored.
        // Known once the server answered: the watchdog hands it back (the server decides if it is refundable).
        let watchdogScanId: string | null = null;
        // 10-30 (Lucas: 5 trial scans, 1 card): once the server has read the card, the watchdog stands down. The
        // read is paid for, and what is left (match lookup, save) has its own timeouts, so the card always lands.
        let readIn = false;
        const watchdog = setTimeout(() => {
          if (readIn) return;
          if (itemsRef.current.find((i) => i.id === next.id)?.status !== "scanning") return;
          patchItem(next.id, { status: "error", error: "Took too long — try again" });
          abandoned.current.add(next.id);
          // Review 10-19 #5: a timed-out scan used to keep its credit AND its worker slot (the body below was
          // still awaiting), so two hung scans froze the queue. Give the scan back and hand the slot to a fresh
          // worker; the hung body finishes on its own and every late patch is ignored (abandoned).
          if (watchdogScanId) {
            void giveBackScan(watchdogScanId).then((usage) => {
              if (!usage) return;
              setScanUsage(usage);
              patchUser({ scans: usage });
            });
          }
          freed = true;
          pumpingRef.current--;
          void pump();
        }, SCAN_WATCHDOG_MS);
        try {
          // Vision only (no OCR fallback since 10-12): the read is the card, or the scan fails and says so.
          // "Switch to <game>" (Chris 10-22: "should only be 1 scan ... on the backend"): the wrong-game read already
          // carries name, number and set code for the other game (10-22 measure: 19 of 20 of Chris's Magic scans read
          // under the Pokémon prompt matched on name + number, set code 20/20), so it is reused as that game instead of
          // sending the same photo to the reader again. Its scan id rides along so a miss still gives the scan back.
          const reuse =
            next.reread && next.vision && next.vision.detectedGame === next.game && next.vision.name && next.vision.cardNumber
              ? next.vision
              : null;
          const vision: VisionScanOutcome = reuse
            ? { status: "done", read: reuse, usage: null, error: null, scanId: next.scanId ?? null }
            : await scanCardWithVision(next.file, next.language, next.game);
          watchdogScanId = vision.scanId ?? null;
          readIn = true;
          // The watchdog fired before the server answered. A real read still becomes the card (10-30, Chris: "every
          // single one needs to give a result"): the row comes back from "Took too long" and finishes below, on this
          // worker, which then stops (its slot already went to a fresh worker). Only a failed read, or a row the seller
          // removed meanwhile, hands the scan back as before (10-22).
          const stillListed = itemsRef.current.some((i) => i.id === next.id) && !deleted.current.has(next.id);
          if (freed && vision.status === "done" && vision.read && stillListed) {
            abandoned.current.delete(next.id);
            patchItem(next.id, { status: "scanning", error: null });
          } else if (freed) {
            if (vision.scanId) {
              void giveBackScan(vision.scanId).then((usage) => {
                if (!usage) return;
                setScanUsage(usage);
                patchUser({ scans: usage });
              });
            }
            return;
          }
          // Same give-back for every empty outcome below (10-22: was pasted twice).
          const giveBackThisScan = () => {
            if (!vision.scanId) return;
            void giveBackScan(vision.scanId).then((usage) => {
              if (!usage) return;
              setScanUsage(usage);
              patchUser({ scans: usage });
            });
          };

          if (vision.usage) {
            setScanUsage(vision.usage);
            // The header counter follows every scan (Chris, 09-07).
            patchUser({ scans: vision.usage });
            // The last free scan just went (10-08, Chris: "I had to refresh the scan page to get the wall"): re-read the
            // session now so appAccess flips and the gate shows the wall as soon as the camera closes.
            if (vision.usage.remaining === 0) void refresh();
          }
          // A trial that just ran out: re-read the session so the
          // SubscriptionGate swaps the scanner for the paywall.
          if (vision.status === "quota" && vision.usage?.remaining !== 0) void refresh();
          if (vision.status === "quota" && !quotaNoteDismissed.current) {
            // The server's 402 names the next credit date, a Booster or the paused scans.
            setQuotaNote(vision.error ?? "You're out of scans.");
          }
          // Out of scans = no scan (Chris 10-12): the on-device OCR fallback read a bedsheet as an Espeon and saved it.
          if (vision.status === "quota") {
            patchItem(next.id, { visionStatus: vision.status, status: "error", error: vision.error ?? "You're out of scans." });
            continue;
          }

          let nameCandidates: string[];
          let printed: PrintedNumber | null;
          let language = next.language;
          // Frame style from the photo — the tiebreak that keeps a full-art
          // card off its promo/regular printing when the number is unread.
          let art: ArtStyle = null;
          // MTG: the rest of the read (finish, frame, marks, artist, year) —
          // tie-breakers for the ranker, and the finish picks the price line.
          let cues: MtgCues | null = null;
          let readError: string | null = null;
          // The photo is another game's card (the read's detectedGame): offered as a switch, see ScanItem.wrongGame.
          let wrongGame: GameId | null = null;
          // MTG Art Series: vision flagged it, so only art sets may answer.
          let artOnly = false;
          let artMiss: string | null = null;

          if (vision.status === "done" && vision.read) {
            const read = vision.read;
            // No auto-switch here (Chris 10-12; review 10-19 #25): /api/vision/scan never re-reads under another
            // game, so the read is always this game's; another game's card is the readError below. The free trial
            // (/api/vision/trial + lib/client/trialScan.ts) still switches by itself.
            // The photo outranks the seller's language toggle — stacks get sorted wrong.
            language = read.language;
            art = read.artStyle ?? null;
            if (next.game === "mtg") cues = mtgCuesOf(read);
            nameCandidates = [read.name, read.englishName].filter(
              (n): n is string => Boolean(n),
            );
            // Vision reads the set symbol and the whole fraction, which is what
            // settles an original against a same-numbered reprint.
            // A Pokémon read with no number keeps its set clues (readHasPrintedKey).
            printed = readHasPrintedKey(read, next.game)
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

            // The photo's condition is a hint in the editor, never the copy's condition (Chris 10-21: "everything is
            // showing up lightly played", "make the default near mint"): since 10-19 it called 19 of his 22 scans
            // Lightly Played, and a first buyer's 66 scans had no Near Mint at all. Every scan keeps the starting
            // condition (Near Mint unless the seller picked another in the scanner's options).
            patchItem(next.id, {
              vision: read,
              visionStatus: "done",
              language,
              wrongGame: null,
            });

            // Two reads that must not become a guess (Chris's 09-03 MTG stress
            // test): a near-zero confidence read ("Unknown", 5%) whose one
            // word prefix-matched a real card, and Magic TOKENS (collector
            // number "T 0016") that aren't in the mirror and rode a
            // substring onto a priced card. Say what happened instead.
            // Art cards carry no number, so the model rates its name+number
            // confidence low even when the name is plain — the floor applies
            // to real cards only.
            const otherGame = read.detectedGame && read.detectedGame !== next.game && read.detectedGame !== "other" ? read.detectedGame : null;
            if (otherGame) {
              // Another game's card is never forced onto this game's catalogue. One we scan stays on the list with
              // its photo and a "Switch to <game>" button (wrongGame; Chris 10-20: "keep the scan and ask the user
              // to switch"); this read is given back as before (10-12: not counted). A game we don't scan says so.
              if (isGameId(otherGame)) {
                wrongGame = otherGame;
                readError = `That looks like a ${GAMES[otherGame].label} card`;
              } else {
                readError = `That looks like a ${otherGame} card — CardFlip doesn't scan those yet`;
              }
              nameCandidates = [];
              printed = null;
            } else if (typeof read.confidence === "number" && read.confidence < UNREADABLE_CONFIDENCE && read.kind !== "art") {
              readError = "Couldn't read this card — retake with the whole card in the guide and no glare"; // no "% sure" anywhere (Chris 10-15)
              nameCandidates = [];
              printed = null;
            } else if (read.slab && GRADED_LOCKED) {
              // A slab photo still shows the card clearly under the plastic.
              // No name = a bad photo the reader called a slab (Chris 09-29:
              // a blurry Kraven in a toploader) — ask for a retake instead.
              readError = read.name?.trim()
                ? SLAB_MESSAGE
                : "Couldn't read this card — retake with the whole card in the guide and no glare";
              nameCandidates = [];
              printed = null;
            } else if (
              next.game === "mtg" &&
              (read.kind === "token" || (read.cardNumber && /^T\s*\d+$/i.test(read.cardNumber.trim())))
            ) {
              readError = "That's a token — tokens aren't accepted. Scan a playable card";
              nameCandidates = [];
              printed = null;
            } else if (next.game === "mtg" && read.kind === "art" && ART_CARDS_LOCKED) {
              // Chris 09-10: tokens and art cards were the unreliable scans;
              // a plain lock beats a guess. The picture match stays in the
              // read path for the day this flips.
              readError = "That's an art card — art cards aren't accepted. Scan a playable card";
              nameCandidates = [];
              printed = null;
            } else if (next.game === "mtg" && read.kind === "art") {
              // Art Series cards live in their own "A<set>" code (AFIN for
              // Final Fantasy). Vision often reads the parent code off the
              // card, or no code at all; either way only art sets may
              // answer, so the art card wins over the playable card of the
              // same name (09-03).
              artOnly = true;
              art = "full-art";
              // The name on an art card is small type along the bottom edge;
              // when the reader can't make it out ("Unknown", 09-03) say
              // that instead of the generic no-match line.
              artMiss = "Art card — couldn't read the name along the bottom edge. Retake closer, sharp, no glare";
              if (printed) {
                const code = (printed.setCode ?? "").toUpperCase();
                if (code && !code.startsWith("A")) printed = { ...printed, setCode: `A${code}` };
              }
            }
          } else if (vision.rateLimited) {
            // 429: the server refused before reading. OCR would only hide that, so say what happened.
            patchItem(next.id, { visionStatus: vision.status, status: "error", error: rateLimitMessage(vision.rateLimited) });
            continue;
          } else if (vision.timedOut) {
            // The server ran out of its read budget: OCR would add a slow second miss (14 s) and the wrong advice.
            patchItem(next.id, { visionStatus: vision.status, status: "error", error: "Took too long — tap Capture again" });
            continue;
          } else if (vision.blurry) {
            // Refused before any paid call (lib/server/photoSoftness.ts): nothing was taken, nothing to give back.
            patchItem(next.id, { visionStatus: vision.status, status: "error", error: vision.error ?? "Too blurry to read the card. Hold still, then tap Capture again." });
            continue;
          } else {
            // Vision failed or is not configured: no OCR fallback (rule since 10-12, review 10-19 #4: the
            // on-device OCR read a bedsheet as an Espeon and SAVED it). A failed read is a failed read; the seller
            // shoots again. A request cut off mid-way (10-30) may still have been read and charged on the server:
            // the sweep before the next scan (lib/server/scanGiveback.ts sweepUnsavedScans) gives that one back.
            patchItem(next.id, { visionStatus: vision.status, status: "error", error: "Couldn't read this card — tap Capture again" });
            continue;
          }

          let matches: Awaited<ReturnType<typeof searchCards>> = [];
          // One flaky request shouldn't end the scan while a later candidate
          // would have matched, so a failed lookup moves on to the next name
          // and only counts as an outage if every one of them failed.
          let lookupErrors = 0;
          let searchLimited = false;

          // Substring hits are not a reason to stop: three stray letters of
          // OCR debris can "match" two dozen unrelated cards (a foil Mewtwo
          // once came back as Illumise this way) while the candidate that
          // names the card exactly sits later in the list. A non-exact result
          // is only a fallback; the walk ends early on an exact name.
          for (const candidate of nameCandidates) {
            try {
              const found = await searchCards(candidate, printed, language, undefined, next.game, art, artOnly, vision.read?.firstEdition ?? null, cues);
              if (found.length === 0) continue;
              if (matches.length === 0) matches = found;
              if (
                found[0].name.trim().toLowerCase() ===
                candidate.trim().toLowerCase()
              ) {
                matches = found;
                break;
              }
            } catch (err) {
              lookupErrors++;
              if (String(err).includes("(429)")) searchLimited = true;
            }
          }

          // Every name missed, but the fraction came off a different band of
          // the card and can identify it alone — glare on the name is exactly
          // when this is worth trying, and it costs one request.
          // (Pokémon: number + set total; MTG: number + printed set code.)
          const numbersIdentify =
            next.game === "mtg"
              ? Boolean(printed?.setCode)
              : Boolean(printed?.number && printed?.setTotal) && language === "en";
          if (matches.length === 0 && printed && numbersIdentify) {
            try {
              matches = await searchCards("", printed, language, undefined, next.game, null, false, vision.read?.firstEdition ?? null, cues);
            } catch (err) {
              lookupErrors++;
              if (String(err).includes("(429)")) searchLimited = true;
            }
          }

          // Two printings within a point of each other: the printed key has
          // run out, so the picture decides (09-10, the 99% push). One call
          // to the stronger model on ties only; on null the order stands.
          // Two printings too close to call: the picture tiebreak (Opus) used to be awaited HERE, holding the
          // card off the screen for up to 5 s (10-11, Chris: "scanning was kinda slow"). Now the top match
          // shows at once and the tiebreak runs after the ledger row exists (below); if it picks the other
          // printing and the seller has not verified yet, the card swaps with a Check-match line.
          const tieIds = vision.status === "done" ? tiebreakIds(matches, next.game, !printed?.number) : [];
          // This scan's own check: a "Scan again" inside the ~5 s starts a new one, and the old answer must not settle it.
          const tieRun = {};

          // >= rather than ==: the number-only fallback above can add an error
          // of its own, and a scan that produced no name candidates at all
          // shouldn't read as an outage.
          if (
            matches.length === 0 &&
            lookupErrors > 0 &&
            lookupErrors >= nameCandidates.length
          ) {
            // Every lookup failed — that's the card database being down, not a
            // bad photo. Telling the seller to re-shoot would waste their time.
            patchItem(next.id, {
              status: "review",
              candidates: [],
              card: null,
              error: searchLimited ? "Too many lookups at once — wait a few seconds, then tap Scan again" : "Card lookup is down right now — search by name to retry",
            });
            // The seller got nothing here either: same give-back as a miss (10-11).
            giveBackThisScan();
          } else if (matches.length === 0) {
            patchItem(next.id, {
              status: "review",
              candidates: [],
              card: null,
              error: readError ?? artMiss ?? "No match found — search by name",
              wrongGame,
              scanId: vision.scanId ?? null,
            });
            // Nothing found = not a scan (Chris, 10-11: "forgiving of bad scans, it doesn't deliver a product").
            // Every empty outcome asks: no match, couldn't read, another game, token, art card, slab. The server
            // decides from the stored read (lib/server/scanGiveback.ts) and answers with the balance.
            // A wrong-game read with a switch on offer is NOT given back yet (10-22): the switch reuses it as the
            // card's real game, so it stays the one paid scan; clearing the card instead gives it back (takeOffList).
            if (!wrongGame) giveBackThisScan();
          } else {
            const card = matches[0];
            // A single match is only "Ready" when the photo actually supported
            // the read. Vision reports confidence in the name+number; a binder
            // shot of a Dondozo ex came back as a 30%-sure "Wailord" with one
            // catalog hit and shipped as Ready (Chris, 09-02). Below the bar it
            // lands as Check match so the seller looks before it lists.
            const lowConfidence =
              vision.status === "done" && typeof vision.read?.confidence === "number" && vision.read.confidence < LOW_CONFIDENCE;
            // Ready is the default; Check match is for a REAL doubt. Several
            // printings alone is not one — most cards have reprints, and when
            // the read number pins the top pick the ranker didn't guess. It
            // did guess when no number was read (tiebreak heuristics) or the
            // number read doesn't match what it picked. (Chris, 09-02: "more
            // than not it should say Ready unless there's a real issue".)
            const numberPinned =
              Boolean(printed?.number) && normalizeNumber(card.number) === normalizeNumber(printed!.number);
            const ambiguous = matches.length > 1 && !numberPinned;
            // Vision read a number the pick doesn't carry: the catalog is
            // missing that printing or the read is off — either way it's the
            // seller's call, not a MATCH.
            const numberMismatch = Boolean(printed?.number) && !numberPinned;
            // Yu-Gi-Oh!: one set code in several foils is a photo guess, not a
            // match — the seller picks the foil (CardEditor "Which foil?").
            // One Piece: one number in several printings, same tap ("Which printing?", 09-30).
            // Promo printings of a regular number (judge pack, winner stamp) and
            // stamped twins (release event / pre-release copies, 10-25) stay in
            // that picker but are no doubt of their own: nearly every copy
            // scanned is the regular card, and it should say Ready.
            const foils =
              next.game === "yugioh"
                ? foilChoices(card, matches).length
                : next.game === "onepiece"
                  ? printingChoices(card, matches).filter((c) => c.id === card.id || isOnePieceSideline(card) || !isOnePieceSideline(c)).length
                  : 0;
            // Lorcana / One Piece / Yu-Gi-Oh! catalogs are English-only: a
            // Japanese One Piece card carries the same number and matches the
            // English card at the English price (10-01: 8 of 155 eBay seller
            // photos were Japanese prints, most titled as plain or "English").
            const foreignPrint = (next.game === "onepiece" || next.game === "lorcana" || next.game === "yugioh") && language !== "en";
            tieRuns.current.set(next.id, tieRun);
            patchItem(next.id, {
              status: lowConfidence || ambiguous || numberMismatch || foreignPrint || foils > 1 ? "review" : "ready",
              candidates: matches,
              card,
              // The picture tiebreak below may still swap the printing: the camera holds the price until it answers.
              printingCheck: tieIds.length >= 2 && next.file ? "pending" : undefined,
              // 1st Edition is its own catalog card (the "-1st" twin); the
              // stamp vision read chose it in the search ranking above.
              firstEdition: isFirstEditionCard(card),
              // MTG: the finish vision read off the shine is the price line
              // (foil is often the bigger price difference); only when the
              // printing actually comes in that finish. Null = default pick.
              // Pokémon: the reverse-holo symbol it read (theme ball, Energy
              // Symbol, Prismatic Poké / Master Ball) picks that pattern's line,
              // only among the lines the card is priced in (lib/foilPattern.ts).
              variant:
                cues?.finish && (card.finishes ?? []).includes(cues.finish)
                  ? cues.finish
                  : next.game === "pokemon" && !isFirstEditionCard(card)
                    ? patternPrintingFor(vision.read, card.prices.filter((p) => p.currency === "USD" && p.market != null && p.market > 0).map((p) => p.variant))
                    : null,
              error: null,
              matchDoubt: lowConfidence
                ? `low-confidence read (${Math.round((vision.read?.confidence ?? 0) * 100)}%)`
                : numberMismatch
                  ? `read #${printed!.number}, closest printing is #${card.number}`
                  : next.game === "onepiece" && card.setCode === ONE_PIECE_DON_SET
                    ? // No number, no name: a photo cannot pin one of ~190 DON!! cards (10-01 test: 2 of 10).
                      "DON!! card, pick yours: search DON plus the character or set"
                  : ambiguous
                    ? `${matches.length} printings matched, no number read`
                    : foreignPrint
                      ? `${language === "ja" ? "Japanese" : "Chinese"} card, the price shown is for the English print`
                      : foils > 1
                        ? `comes in ${foils} foils, pick yours`
                        : // B1 10-20: foil seen, symbol not (Prismatic's big faint ball hides under a lamp), and this
                          // card sells as pattern printings: the seller tilts it and picks, instead of a silent default.
                          next.game === "pokemon" &&
                            (vision.read?.foilPattern === "reverse" || (vision.read?.foilPattern == null && vision.read?.patternLook != null)) &&
                            card.prices.filter((p) => p.currency === "USD" && p.market != null && p.market > 0 && /BallPattern$/.test(p.variant)).length >= 2
                          ? "reverse holo: tilt it to see the ball, then pick Poké Ball or Master Ball under Printing"
                          : null,
            });

            // Vision may already have graded the card, so read the condition
            // back off the item rather than assuming Near Mint.
            const condition =
              itemsRef.current.find((i) => i.id === next.id)?.condition ?? "Near Mint";
            // The printing set just above (Magic finish, Pokémon pattern) prices the saved row too.
            const pickedVariant = itemsRef.current.find((i) => i.id === next.id)?.variant ?? undefined;
            const quote = quotePrice(card, condition, "quick", pickedVariant);
            const input = {
              cardName: card.englishName || card.name,
              setName: card.setName,
              cardNumber: card.number,
              imageUrl: card.imageSmall,
              condition,
              price: quote?.suggested ?? 0,
              // "Added at" compares against the market ask Inventory refreshes to, not the quick-sale price.
              scanPrice: quotePrice(card, condition, "market", pickedVariant)?.suggested ?? null,
              // The market the chip SHOWS: packs add these up (Chris 10-12: 3 × $10,000 read as $23,069).
              scanMarket: (() => {
                const shown = itemsRef.current.find((i) => i.id === next.id);
                return shown ? headlinePrice({ ...shown, card }) || null : null;
              })(),
              game: next.game,
              catalogCardId: card.id || null,
              rarity: card.rarity ?? null,
              // Auto (10-29) = this card's own set.
              category: resolveCategory(scanCategoryRef.current, next.game, card.setName, knownCategoriesRef.current),
              // Pulls from an open pack (Open a Pack) are tied to it.
              packId: readActivePackId(userIdRef.current),
              // The finish the scan read (Magic foil / etched), set on the
              // item just above — a foil saved as the default finish would
              // list on eBay as Regular and refresh off the nonfoil series.
              variant: itemsRef.current.find((i) => i.id === next.id)?.variant ?? null,
              // Same id on the retry below: a first POST that landed but timed out must not leave a twin row (10-22).
              clientId: vision.scanId ?? next.id,
            };
            // Without a server row the card can't be published or appear in
            // the collection — one retry covers the usual flaky-network blip.
            // The watchdog gave up on it, or the seller deleted it meanwhile: no ghost row in Inventory.
            // A row merely CLEARED from the list still saves (10-14): clearing promises the card stays.
            if (abandoned.current.has(next.id) || deleted.current.has(next.id)) continue;
            const server = (await createServerCard(input)) ?? (await createServerCard(input));
            if (server && (abandoned.current.has(next.id) || deleted.current.has(next.id))) {
              // Abandoned or deleted while the row was being created: delete the orphan.
              void deleteServerCard(server.id);
            } else if (!server) {
              // No row = no tiebreak: nothing is left to wait on.
              patchItem(next.id, { status: "error", error: "Couldn't save — tap Scan again", printingCheck: undefined });
              // The scan was charged and the card showed; the account log should say so (10-14).
              reportSaveFailed(input, vision.scanId ?? null);
            } else {
              patchItem(next.id, { serverId: server.id });
              // Verified, re-graded or re-printed before the row existed (fast tap in the first 1-2 s): sync it
              // now. Review 10-19 #6: the row was created from the scan's condition / printing, and an edit made
              // while POST /api/cards was in flight had no row to land on, so Inventory kept the scan's values.
              const cur = itemsRef.current.find((i) => i.id === next.id);
              const lateCondition = cur && cur.condition !== condition ? describeItemCondition(cur) : null;
              const lateVariant = cur && (cur.variant ?? null) !== (input.variant ?? null) ? (cur.variant ?? null) : undefined;
              // A "Not this card?" pick in that window too (10-20, the first Booster buyer's Umbreon): swapCard had
              // no row to rename, so the row kept the scan's card while the pick's price landed on it later.
              const lateCard = cur?.card && cur.card.id !== card.id ? cur.card : null;
              if (cur && (lateCard || cur.verifiedAt || cur.matchDoubt || cur.firstEdition || lateCondition || lateVariant !== undefined)) {
                void updateServerCard(server.id, {
                  ...(lateCard
                    ? {
                        cardName: lateCard.englishName || lateCard.name,
                        setName: lateCard.setName,
                        cardNumber: lateCard.number,
                        imageUrl: lateCard.imageSmall,
                        catalogCardId: lateCard.id || null,
                        rarity: lateCard.rarity ?? null,
                        firstEdition: isFirstEditionCard(lateCard),
                        ...ledgerPriceForNewCard(cur),
                      }
                    : {}),
                  ...(cur.verifiedAt ? { verifiedAt: cur.verifiedAt } : {}),
                  ...(cur.matchDoubt ? { matchDoubt: cur.matchDoubt } : {}),
                  ...(cur.firstEdition ? { firstEdition: true } : {}),
                  ...(lateCondition ? { condition: lateCondition } : {}),
                  ...(lateVariant !== undefined ? { variant: lateVariant } : {}),
                  // The row was created with the scan's card / printing market; packs count the one on screen now.
                  ...(lateCard || lateVariant !== undefined ? { scanMarket: headlinePrice(cur) || null } : {}),
                });
              }
              // The picture tiebreak, off the critical path (10-11): the row exists, so a late pick renames it
              // through swapCard. Dropped when the seller already verified, listed or removed the card, or
              // when the pick is the card already showing. Not awaited: the pump moves on to the next scan.
              if (tieIds.length >= 2 && next.file) {
                const file = next.file;
                const picked = card;
                const shown = matches;
                void tiebreakCard(file, next.game, tieIds).then((winner) => {
                  const now = itemsRef.current.find((i) => i.id === next.id);
                  // A seller's own pick meanwhile (swapCard) already ended the check: their card stands.
                  if (now?.printingCheck !== "pending" || tieRuns.current.get(next.id) !== tieRun) return;
                  const other =
                    winner && winner !== picked.id && now.card?.id === picked.id && !now.verifiedAt && now.status !== "listed" && now.status !== "sold"
                      ? shown.find((m) => m.id === winner)
                      : undefined;
                  if (other) swapCard(next.id, other, shown, `printing swap: the photo looks more like this printing than ${picked.setName}`);
                  // Swapped or kept, the printing is settled: the camera shows its price now.
                  patchItem(next.id, { printingCheck: "done" });
                });
              }
              // Persist the seller's own photo now, not at eBay-push time.
              // It is the only image a listing is ever sent (picture policy:
              // the actual item, never catalogue art), and until it reaches
              // the server it exists only in this tab -- a refresh loses it
              // and the push has to race an upload. Deliberately NOT awaited:
              // awaiting stalled the pump ~a second per card while the JPEG
              // uploaded, which read as "everything is laggy" on a stack
              // (08-27). Failure is not surfaced: the send path still falls
              // back to the in-memory file, so a miss costs nothing beyond
              // the old behaviour.
              if (next.file) {
                // One retry: 1 of 35 uploads silently missed on the 09-03 MTG
                // stress test, and a row without its photo can't be listed
                // after a refresh.
                const file = next.file;
                void uploadCardPhoto(server.id, file).then(async (uploaded) => {
                  if (uploaded.ok) {
                    patchItem(next.id, { photoAt: uploaded.photoAt });
                    return;
                  }
                  await new Promise((r) => setTimeout(r, 1500));
                  const again = await uploadCardPhoto(server.id, file);
                  if (again.ok) patchItem(next.id, { photoAt: again.photoAt });
                });
              }
            }
          }
        } catch {
          // Reading the image itself failed, which really is about the photo.
          patchItem(next.id, {
            status: "error",
            error: "Couldn't read this photo — try a straighter, brighter shot",
          });
        } finally {
          clearTimeout(watchdog);
        }
        // The watchdog already gave this slot to a fresh worker: this one must not pick up another item.
        if (freed) return;
      }
    } finally {
      if (!freed) pumpingRef.current--;
    }
  }, [patchItem, patchUser, refresh, swapCard]);

  /**
   * Price the card against what it's actually going for on eBay. Deliberately
   * not awaited inside the scan loop: a stack of cards should keep moving
   * through OCR while eBay answers, with each price sharpening as it lands.
   */
  /**
   * The chart's current point, stored on the item so every consumer prices
   * off it (see ScanItem.currentPoint). Re-saves the ledger price once it's
   * known, unless the seller typed one.
   */
  const loadCurrentPoint = useCallback(
    async (id: string, card: PokemonCard) => {
      const before = itemsRef.current.find((i) => i.id === id);
      const point = await lastRecordedPoint(card.id, before ? (effectiveVariant(before) ?? null) : null).catch(() => null);
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item || item.card?.id !== card.id) return;
      patchItem(id, { currentPoint: point });
      if (item.serverId && item.priceOverride == null && item.language === "en" && item.status !== "listed" && item.status !== "sold") {
        const quote = quoteForItem({ ...item, currentPoint: point });
        if (quote) void updateServerCard(item.serverId, { price: quote.suggested });
      }
    },
    [patchItem],
  );

  /** The printing to pull eBay comps for: the item's quoted printing when the card's own (non-eBay) prices carry it. */
  const compsPrinting = (item: ScanItem | undefined, card: PokemonCard): string | null => {
    const v = item ? effectiveVariant(item) : undefined;
    return v && card.prices.some((p) => p.variant === v && p.source !== "ebay") ? v : null;
  };

  const loadEbayComps = useCallback(
    async (id: string, card: PokemonCard, firstEditionOverride?: boolean) => {
      compsInFlight.current.add(id);
      patchItem(id, { ebayStatus: "loading" });
      let printing: string | null = null;
      // The point rides alongside the comps; whichever lands second re-saves
      // the price, so the ledger ends up on the same number as the screen.
      void loadCurrentPoint(id, card);

      try {
        // 1st Edition copies are their own eBay market — the comps are pulled
        // for the printing the item claims to be (stamped listings excluded
        // for an unlimited copy of a set that had a run).
        const current = itemsRef.current.find((i) => i.id === id);
        const stamped = firstEditionOverride ?? (current ? itemFirstEdition(current) : false);
        // The printing being quoted (the scan's pattern read or the seller's pick): a reverse holo or Poké Ball
        // pattern card is priced against its own asks, not the plain card's (10-22).
        printing = compsPrinting(current, card);
        const result = await fetchEbayComps(card, null, canBeFirstEdition(card) ? stamped : null, printing);
        const item = itemsRef.current.find((i) => i.id === id);
        // Dropped from the queue, or the seller corrected the match while we
        // were waiting — either way these comps are for the wrong card now.
        if (!item || item.card?.id !== card.id) return;

        // Sold and asking data arrive together but can succeed independently,
        // so a card can be repriced off either one.
        if (result.comps || result.sold) {
          const repriced = withEbayPrices(item.card, {
            sold: result.sold,
            active: result.comps,
          });
          patchItem(id, {
            ebay: result.comps,
            ebayStatus: result.comps ? "done" : result.status,
            ebaySold: result.sold,
            ebaySoldStatus: result.soldStatus,
            ebaySoldUrl: result.soldSearchUrl,
            card: repriced,
          });

          // English scans only: comps for a CJK card are keyword noise
          // (eBay matched on a Chinese/Japanese name against US listings),
          // and auto-writing that number over the honest $0.00 is how a
          // Chinese card "got priced" at nonsense (Chris, 08-28 — "it
          // needs to be $0.00"). The comps still render as reference;
          // the seller prices the card themselves.
          if (item.serverId && item.language === "en" && item.status !== "listed" && item.status !== "sold") {
            const quote = quoteForItem({ ...item, card: repriced });
            if (quote) {
              void updateServerCard(item.serverId, {
                price: item.priceOverride ?? quote.suggested,
              });
            }
          }
        } else {
          patchItem(id, {
            ebay: null,
            ebayStatus: result.status,
            ebaySold: null,
            ebaySoldStatus: result.soldStatus,
            ebaySoldUrl: result.soldSearchUrl,
          });
        }
      } finally {
        compsInFlight.current.delete(id);
        // The card changed while this lookup was out: the effect below skipped the new card because this
        // one was in flight, and nothing re-ran it after (Angel #25 kept the D23 promo's price, 10-20).
        // A no-op patch re-renders, so the effect picks the new card up now.
        // Same when the seller picked another printing while it was out: these comps are the old printing's.
        const now = itemsRef.current.find((i) => i.id === id);
        if (now?.card && now.card.id !== card.id && now.ebayStatus === "idle") patchItem(id, { ebayStatus: "idle" });
        else if (now?.card && now.card.id === card.id && compsPrinting(now, now.card) !== printing) patchItem(id, { ebayStatus: "idle" });
      }
    },
    [patchItem, loadCurrentPoint],
  );

  // One lookup at a time: as each finishes the queue re-settles and the next
  // idle card is picked up, which also covers cards whose match was corrected
  // by hand (that patch resets ebayStatus to "idle").
  useEffect(() => {
    const pending = items.find(
      (i) =>
        i.card &&
        // Sealed items skip comps entirely: the comp filters are built to
        // *reject* sealed lots when pricing a single card.
        i.kind !== "sealed" &&
        i.ebayStatus === "idle" &&
        !compsInFlight.current.has(i.id),
    );
    if (pending?.card) void loadEbayComps(pending.id, pending.card);
  }, [items, loadEbayComps]);

  // Anything that lands back in "queued" — the editor's "Scan again" /
  // "Use a different photo" buttons — restarts the pump (it guards its own
  // re-entry, so this is free when a scan is already running).
  useEffect(() => {
    if (items.some((i) => i.status === "queued" && i.file)) void pump();
  }, [items, pump]);

  const addFiles = useCallback(
    (files: File[]) => {
      const created = files.map((file) => createItem(file, language, game));
      commit([...itemsRef.current, ...created]);
      setSelectedId((current) => current ?? created[0]?.id ?? null);
      void pump();
      // The camera needs to follow the item its capture created.
      return created.map((item) => item.id);
    },
    [commit, pump, language, game],
  );

  // addCardFromSearch / addSealedProduct (the add-without-a-photo roads)
  // were removed 09-01 with their UI — eBay only accepts photos of the
  // actual item, so a queue entry with no scan photo was a dead end.
  // Sealed product (photo-first, Tier 2 #13, 09-27) was removed 10-03 with
  // every upload path (Chris: eBay rejects stock pictures; every listing
  // starts from a camera scan). Existing sealed rows still open in
  // SealedEditor; nothing new can be added.

  /** "Which category?" over the queue, once per scanning session, for the cards in sessionItemIdsRef.
   *  A pack scan is filed under its pack, so no ask over it. Only when something was actually identified
   *  (10-11, Chris: a floss box that "couldn't be read" still got asked "Which category?" and then had
   *  nothing to file). */
  const askCategory = useCallback((scanned: boolean) => {
    if (scanned && !categoryAskedRef.current && !readActivePackId(userIdRef.current)) {
      categoryAskedRef.current = true;
      setCategoryPrompt({ existing: [] });
      void fetchCategories(gameRef.current).then((list) => {
        knownCategoriesRef.current = list;
        setCategoryPrompt((p) => (p ? { existing: list } : p));
      });
    }
  }, []);

  // /app?resume=<ledger id>: reopen ONE draft from My cards in the editor
  // (Chris, 09-01 — he was rescanning cards just to get the build page
  // back). The search re-fetches the catalog card with prices; the row
  // supplies photo, price, condition and quantity. Fresh-start rule stays:
  // nothing restores without the explicit link. `resuming` starts true when
  // the param is present so the empty-state hero never flashes first.
  const resumedRef = useRef(false);
  const [resuming, setResuming] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("resume"),
  );
  // What the reopen screen shows while the rebuild runs: the name and the
  // seller's photo (or the catalogue art) that My Cards passed along, so the
  // wait looks like the card coming back rather than a spinner (09-04).
  const [resumeHint, setResumeHint] = useState<{ name: string | null; image: string | null }>({ name: null, image: null });
  /**
   * Ledger rows back into the queue, rebuilt from the catalog (the row supplies photo, price, condition,
   * quantity). Two callers: the ?resume= link below, and the iPhone app's camera, which hands its new
   * scans into this page IN PLACE over a "cardflip:resume" window event (10-29): the queue stays as it
   * was, the new rows join it, the first one opens in the editor, "Which category?" asks over them, the
   * way this page's own camera sheet closes. `quiet` skips the reopen hero (the queue is on screen);
   * rows already in the queue are not rebuilt twice, just selected.
   */
  const resumeFromLedger = useCallback(
    async (
      wantedIds: string[],
      hints: { name: string | null; number: string | null; game: GameId; photoAt: string | null; image: string | null },
      opts: { justScanned: boolean; quiet: boolean },
    ) => {
      const { justScanned, quiet } = opts;
      const hintName = hints.name;
      const hintNumber = hints.number;
      const hintGame = hints.game;
      const hintPhotoAt = hints.photoAt;
      const hintImage = hints.image;
      const present = new Map(itemsRef.current.filter((i) => i.serverId).map((i) => [i.serverId as string, i.id]));
      const resumeIds = wantedIds.filter((id) => !present.has(id));
      if (resumeIds.length === 0) {
        const sel = present.get(wantedIds[0] ?? "");
        if (sel) setSelectedId(sel);
        return;
      }
      if (!quiet) {
        // On a client-side navigation Next updates window.location AFTER the
        // first render, so the state initializer above saw the previous URL
        // and started false — the first-scan hero then sat there for the whole
        // rebuild (Chris, 09-02: "hanging on this screen for 5-7 seconds").
        // Set here, past the effect's synchronous body (react-hooks rule), a
        // microtask later and long before any network answer.
        await Promise.resolve();
        setResuming(true);
        setResumeHint({
          name: resumeIds.length === 1 ? hintName : null,
          image:
            resumeIds.length === 1 && hintPhotoAt
              ? apiPath(`/api/card-image/${resumeIds[0]}?v=${hintPhotoAt}`)
              : resumeIds.length === 1
                ? hintImage
                : null,
        });
      }
      const eagerSearch = hintName
        ? searchCards(hintName, hintNumber || null, "en", undefined, hintGame).catch(() => null)
        : null;
      const rows = (await fetchServerCards()) ?? [];
      const wanted = resumeIds
        .map((id) => rows.find((r) => r.id === id))
        .filter((r): r is ServerCard => Boolean(r) && r!.kind !== "sealed" && r!.status !== "sold");
      if (wanted.length === 0) {
        setResuming(false);
        toast(resumeIds.length === 1 ? "Couldn't reopen that card here — scan it again" : "Couldn't reopen those cards here", "err");
        return;
      }
      // The eager result is only trusted when the hint matches the row (a
      // stale or hand-edited link falls back to the exact lookup). Hints
      // only ride along on single-card links.
      const build = async (row: ServerCard): Promise<ScanItem | null> => {
        const game = parseGame(row.game);
        const eager =
          wanted.length === 1 && hintName === row.cardName && (hintNumber || "") === (row.cardNumber || "")
            ? await eagerSearch
            : null;
        // The ledger row's catalog id IS the card — one indexed fetch, no
        // name walk to get wrong (09-03: a double-faced Magic name failed
        // the walk and the row couldn't be reopened).
        const direct = row.catalogCardId
          ? await fetchCardById(row.catalogCardId, game).catch(() => null)
          : null;
        const results = direct
          ? [direct]
          : (eager ?? (await searchCards(row.cardName, row.cardNumber || null, "en", undefined, game).catch(() => [])));
        const card = pickPrinting(results, row);
        if (!card) return null;
        return buildResumed(row, game, results, card);
      };
      // Lookups run side by side — a selection of ten shouldn't take ten
      // round trips in a row.
      const built = await Promise.all(wanted.map(build));
      const items = built.filter((i): i is ScanItem => Boolean(i));
      if (items.length === 0) {
        setResuming(false);
        toast("Couldn't look those cards up again — scan them to rebuild the listings", "err");
        return;
      }
      if (items.length < wanted.length) {
        toast(`${wanted.length - items.length} card${wanted.length - items.length === 1 ? "" : "s"} couldn't be looked up again`, "err");
      }
      commit([...itemsRef.current, ...items]);
      setSelectedId(items[0].id);
      setResuming(false);
      if (justScanned) {
        categoryAskedRef.current = false;
        sessionItemIdsRef.current = items.map((i) => i.id);
        askCategory(true);
      }
      for (const item of items) {
        if (item.status !== "listed" && item.card) void loadEbayComps(item.id, item.card);
        // The id fetch above is why reopening is instant, but it leaves the
        // item with a single candidate — and "Not your card? N other
        // matches" is gated on having more than one (09-04: the link was
        // gone on every resumed card). Fill the alternatives behind the
        // scenes; the card itself stays what the ledger row points at.
        if (item.card && item.candidates.length <= 1 && !item.verifiedAt) {
          const { id, card } = item;
          // One Piece / Yu-Gi-Oh!: the printing pick IS the verification, so
          // the editor holds its plain "Yes" until these candidates are in.
          const asksPrinting = item.game === "onepiece" || item.game === "yugioh";
          if (asksPrinting) patchItem(id, { printingsCheck: "loading" });
          void searchCards(card.englishName || card.name, card.number || null, "en", undefined, item.game)
            .then((found) => {
              const cur = itemsRef.current.find((i) => i.id === id);
              if (!cur) return;
              const others = found.filter((c) => c.id !== card.id);
              const fill = cur.card?.id === card.id && cur.candidates.length <= 1 && others.length > 0;
              if (fill || asksPrinting) {
                patchItem(id, { ...(fill ? { candidates: [card, ...others] } : {}), ...(asksPrinting ? { printingsCheck: null } : {}) });
              }
            })
            .catch(() => {
              if (asksPrinting) patchItem(id, { printingsCheck: "failed" });
            });
        }
      }
    },
    [askCategory, commit, loadEbayComps, patchItem],
  );
  useEffect(() => {
    if (resumedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    // One id, or several comma-joined: My Cards' "Move to listings" sends a
    // whole selection here so they can be verified in one sitting instead
    // of one round trip each (Chris, 09-03).
    const resumeIds = (params.get("resume") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (resumeIds.length === 0) return;
    resumedRef.current = true;
    // My Cards passes the card's identity alongside the id so the catalog
    // search runs in PARALLEL with the ledger fetch — sequentially they were
    // two-plus seconds of blank stare on a cold function (Chris, 09-02).
    const hints = { name: params.get("rn"), number: params.get("rnum"), game: parseGame(params.get("rg")), photoAt: params.get("rp"), image: params.get("ri") };
    // The iPhone app's camera just scanned these (10-29, the first build's handoff): they count as this
    // session's scans, so the page asks "Which category?" over them.
    const justScanned = params.get("ask") === "category";
    window.history.replaceState(null, "", window.location.pathname);
    void resumeFromLedger(resumeIds, hints, { justScanned, quiet: false });
  }, [resumeFromLedger]);
  // The iPhone app's camera (mobile/src/app/scan.tsx toQueue -> (app)/scanTab.tsx inject): its new scans,
  // the tapped one first, into the queue in place.
  useEffect(() => {
    const onResume = (e: Event) => {
      const detail = (e as CustomEvent<{ ids?: unknown }>).detail;
      const ids = Array.isArray(detail?.ids) ? detail.ids.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
      if (ids.length === 0) return;
      void resumeFromLedger(ids, { name: null, number: null, game: gameRef.current, photoAt: null, image: null }, { justScanned: true, quiet: true });
    };
    window.addEventListener("cardflip:resume", onResume);
    return () => window.removeEventListener("cardflip:resume", onResume);
  }, [resumeFromLedger]);


  const openCamera = useCallback(() => {
    // Inside the iPhone app this page is the site's own scanner page (10-29, Chris: "match the website almost
    // 1:1"); the camera itself is the app's (the Dual Wide lens, the native reveal). The app scans, then comes
    // back here with ?resume=<ids>&ask=category, which is this page's post-scan state.
    // A toast left over from the previous session would flash a stale result.
    setCameraItemId(null);
    categoryAskedRef.current = false;
    sessionItemIdsRef.current = [];
    // The app's camera hands its scans back into this page in place (the "cardflip:resume" event below),
    // the queue untouched, like this page's own camera sheet closing (Chris 10-29 1:32am: "it's supposed to
    // just add to the list").
    if (postToApp({ type: "scan" })) return;
    setCameraOpen(true);
  }, []);

  /** Captures file silently; the category ask waits for Done (Chris,
   *  09-04: the sheet was covering the card the scanner had just found). */
  const onCameraCapture = useCallback(
    (file: File) => {
      // Capture goes to onGetMore when out of scans, so no photo gets here; this is the backstop (10-22).
      if (outOfScansRef.current) return;
      const id = addFiles([file])[0] ?? null;
      setCameraItemId(id);
      if (id) sessionItemIdsRef.current.push(id);
    },
    [addFiles],
  );

  // Binder page (tier 1 #4, 09-27) was removed 10-03 with every upload path:
  // one card per shot, from the camera, is the only way in.

  /** Camera closed: if this session scanned anything and hasn't been asked
   *  yet, ask "which category?" now, over the queue — never over the reveal. */
  const closeCamera = useCallback(() => {
    scanOpenPending = false;
    setCameraOpen(false);
    askCategory(sessionItemIdsRef.current.some((id) => itemsRef.current.find((i) => i.id === id)?.card));
  }, [askCategory]);

  /** Capture while out of scans (10-22): no burst, no photo. The scanner closes (clearing scanOpenPending), then the
   *  pricing page opens a beat later so the sheet-pop history.back() from the close lands first and can't eat the push. */
  const getMoreScans = useCallback(() => {
    closeCamera();
    window.setTimeout(() => router.push("/pricing"), 200);
  }, [closeCamera, router]);

  // Removal is undoable (Chris, 09-01 QoL pass): the ✕ used to hard-delete
  // the server card instantly — a misclick on a priced, photographed card was
  // unrecoverable. Now the row leaves the queue at once, but the server
  // delete (and preview-URL revoke) waits out the undo window; Undo just
  // puts the captured item back. Pending deletes are flushed if the page
  // unmounts before their timers fire, so nothing silently survives.
  // Two ways off the list (10-14, Jenny: 5 scans, tapped the row ×s to tidy up, 0 cards left):
  //   clear  = the row leaves the scanner only; the card stays in Inventory. The row × and the chip ×.
  //   delete = the card leaves Inventory too, after the in-app confirm. Only the card view's button.
  // `del` on the pending entry says which; the undo window is the same for both.
  const pendingRemovals = useRef(
    new Map<string, { item: ScanItem; index: number; del: boolean; timer: ReturnType<typeof setTimeout> }>(),
  );
  /** Scan ids the seller deleted (not just cleared): the pump never saves these or keeps their ledger row. */
  const deleted = useRef(new Set<string>());
  const finalizeRemoval = useCallback((id: string) => {
    const pending = pendingRemovals.current.get(id);
    if (!pending) return;
    pendingRemovals.current.delete(id);
    clearTimeout(pending.timer);
    URL.revokeObjectURL(pending.item.previewUrl);
    if (pending.del && pending.item.serverId) void deleteServerCard(pending.item.serverId);
  }, []);
  useEffect(() => {
    const removals = pendingRemovals.current;
    return () => {
      for (const id of [...removals.keys()]) {
        const pending = removals.get(id)!;
        removals.delete(id);
        clearTimeout(pending.timer);
        URL.revokeObjectURL(pending.item.previewUrl);
        if (pending.del && pending.item.serverId) void deleteServerCard(pending.item.serverId);
      }
    };
  }, []);

  const takeOffList = useCallback(
    (id: string, del: boolean) => {
      const index = itemsRef.current.findIndex((i) => i.id === id);
      const target = itemsRef.current[index];
      if (!target) return;
      // A wrong-game read cleared instead of switched: nothing came of it, so the scan goes back now (10-22; the
      // pump held the give-back while the switch was on offer).
      if (target.wrongGame && target.scanId && !target.card) {
        void giveBackScan(target.scanId).then((usage) => {
          if (!usage) return;
          setScanUsage(usage);
          patchUser({ scans: usage });
        });
      }

      if (del) deleted.current.add(id);
      const remaining = itemsRef.current.filter((i) => i.id !== id);
      commit(remaining);
      setSelectedId((current) =>
        current === id ? (remaining[0]?.id ?? null) : current,
      );

      pendingRemovals.current.set(id, {
        item: target,
        index,
        del,
        // Longer than the Undo toast (Toaster ACTION_DURATION_MS 6000): the button must never outlive the
        // window it undoes (review 10-19 #8: the last half second did nothing).
        timer: setTimeout(() => finalizeRemoval(id), 6500),
      });
      const name = target.card ? target.card.englishName || target.card.name : "card";
      // The clear toast says where the card still is, so a tidy-up never reads as a loss.
      toast(del ? `Removed ${name} from your Inventory` : target.card ? `Cleared ${name} — still in your Inventory` : "Cleared", "info", {
        label: "Undo",
        onClick: () => {
          const pending = pendingRemovals.current.get(id);
          if (!pending) return;
          pendingRemovals.current.delete(id);
          deleted.current.delete(id);
          clearTimeout(pending.timer);
          const next = [...itemsRef.current];
          next.splice(Math.min(pending.index, next.length), 0, pending.item);
          commit(next);
          setSelectedId(id);
        },
      });
    },
    [commit, finalizeRemoval, patchUser],
  );

  /** Row × / chip ×: off the list, card kept. */
  const clearItem = useCallback((id: string) => takeOffList(id, false), [takeOffList]);

  /**
   * "Switch to <game>" on a wrong-game scan (Chris 10-20: keep the scan, ask to switch): the scanner's game follows,
   * so the next shot starts right, and the same photo is read again as that game. Back to "queued" restarts the pump.
   */
  const switchItemGame = useCallback(
    (id: string, to: GameId) => {
      setGame(to);
      abandoned.current.delete(id);
      // vision stays: the pump reuses the read on file as the new game (one scan, no second reader call, 10-22).
      patchItem(id, { game: to, status: "queued", error: null, wrongGame: null, reread: true, visionStatus: "idle", verifiedAt: null });
    },
    [patchItem, setGame],
  );

  /** Card view "Remove from Inventory": asks first, then the card goes from the ledger too. */
  const deleteItem = useCallback(
    async (id: string) => {
      const target = itemsRef.current.find((i) => i.id === id);
      if (!target) return;
      if (target.card) {
        const name = target.card.englishName || target.card.name;
        const ok = await confirmAction({
          message: `Remove ${name} from your Inventory? Scanning it again uses another scan.`,
          confirmLabel: "Remove card",
        });
        if (!ok) return;
      }
      takeOffList(id, true);
    },
    [takeOffList],
  );

  /**
   * "Send all to eBay": every ready, priced item that isn't on eBay yet gets
   * pushed as a draft, one after another (eBay rate-limits, and a stack of
   * 30 cards is a stack of 30 inventory writes). Same payload the editor's
   * button sends, so a bulk push and a single push can't drift.
   */
  async function sendAllToEbay(retryIds?: string[]) {
    if (!user?.ebayConnected) {
      router.push("/connect-ebay");
      return;
    }
    // Only verified matches go (Chris, 09-03: the lock against blindly
    // posting a wrong match). Unverified ones are counted for the note.
    const unverified = itemsRef.current.filter(
      (item) =>
        item.card &&
        item.serverId &&
        (item.status === "ready" || item.status === "review") &&
        !item.verifiedAt &&
        !item.ebayOfferId &&
        !item.ebayDraftUrl &&
        (!retryIds || retryIds.includes(item.id)),
    ).length;
    const targets = itemsRef.current.filter(
      (item) =>
        item.card &&
        item.serverId &&
        item.status === "ready" &&
        item.verifiedAt &&
        !item.ebayOfferId &&
        !item.ebayDraftUrl &&
        currentPrice(item) > 0 &&
        (!retryIds || retryIds.includes(item.id)),
    );
    // eBay's picture policy: only items with the seller's own photo can go.
    // Search-added / sealed items without one are left for the editor's
    // "Add photo" — never sent with catalogue art.
    const noPhoto = targets.filter((item) => !item.file && !item.photoAt).length;
    const sendable = targets.filter((item) => item.file || item.photoAt);
    if (sendable.length === 0 && unverified > 0) {
      setBulkNote(
        `${unverified} card${unverified === 1 ? " needs" : "s need"} the match verified first — open each one and tap "Yes, this is my card"`,
      );
      return;
    }
    if (sendable.length === 0) {
      setBulkNote(
        noPhoto
          ? `Nothing sent — ${noPhoto} item${noPhoto === 1 ? " needs" : "s need"} your own photo first (eBay doesn't allow stock art). Open each one and add a photo.`
          : "Nothing to send — every priced card is already on eBay or not ready yet.",
      );
      return;
    }
    setBulkBusy(true);
    setBulkNote(null);
    setBulkFailedIds([]);
    let sent = 0;
    let viaInventory = 0;
    let firstError: string | null = null;
    const failedIds: string[] = [];
    for (const item of sendable) {
      const price = currentPrice(item);
      const quote = quoteForItem(item);
      const listing = withListingOverrides(
        item.kind === "sealed"
          ? buildSealedListing(item.card!, price, item.productType)
          : buildListing(item.card!, price, item.condition, quote?.price.label, {
              firstEdition: itemFirstEdition(item),
              grading: item.grading,
            }),
        item,
      );
      const result = await sendEbayDraft({
        cardId: item.serverId!,
        listing,
        card: {
          name: item.card!.name,
          englishName: item.card!.englishName,
          setName: item.card!.setName,
          number: item.card!.number,
          rarity: item.card!.rarity,
          imageLarge: item.card!.imageLarge,
          imageSmall: item.card!.imageSmall,
          typeLine: item.card!.typeLine ?? null,
          setTotal: item.card!.setTotal ?? null,
        },
        game: item.game,
        finish: mtgFinishOf(item),
        printing: item.game === "mtg" ? null : quote?.price.label ?? null,
        kind: item.kind,
        condition: item.condition,
        grading: item.grading,
        firstEdition: itemFirstEdition(item),
        quantity: item.quantity ?? 1,
        productType: item.productType,
        language: item.language,
      }, item.photoAt ? null : item.file);
      if (result.ok) {
        sent += 1;
        if (result.via === "listing") {
          patchItem(item.id, {
            ebayDraftUrl: result.draftUrl,
            ...(result.photoAt ? { photoAt: result.photoAt } : {}),
          });
        } else {
          viaInventory += 1;
          patchItem(item.id, {
            ebayOfferId: result.offerId,
            ebayListingUrl: result.listingUrl,
            ...(result.photoAt ? { photoAt: result.photoAt } : {}),
          });
        }
      } else {
        firstError ??= result.message;
        failedIds.push(item.id);
        // These two sink every later item the same way — stop, and leave the
        // unattempted rest out of failedIds so "Retry failed" doesn't imply
        // they were tried (a fresh "Send all" still picks them up).
        if (result.code === "not_connected" || result.code === "unconfigured") break;
      }
    }
    setBulkBusy(false);
    setBulkFailedIds(failedIds);
    const skipped = noPhoto
      ? ` ${noPhoto} skipped — ${noPhoto === 1 ? "it needs" : "they need"} your own photo (open the card, Add photo).`
      : "";
    // Two roads (see sendEbayDraft): Listing API drafts live in My eBay ›
    // Drafts; Inventory drafts are saved on eBay but publish from here.
    const where = viaInventory > 0 ? "saved on eBay — open each card here to publish" : "in your eBay Drafts — finish them on eBay, or open a card here to publish now";
    setBulkNote(
      firstError
        ? `${sent} of ${sendable.length} sent to eBay — ${failedIds.length} failed. First problem: ${firstError}${skipped}`
        : `${sent} draft${sent === 1 ? "" : "s"} ${where}.${skipped}`,
    );
  }

  if (!user) return <PageSkeleton />;

  const camera = cameraOpen && (
    <CameraCapture
      game={game}
      onGameChange={setGame}
      lastScan={items.find((item) => item.id === cameraItemId) ?? null}
      // Verified cards are not waiting (Chris 10-12: one verified + one new scan said "2 Scans To Verify").
      queue={items.filter((item) => item.card && !item.verifiedAt && item.status !== "listed" && item.status !== "sold")}
      onRemove={clearItem}
      onSwitchGame={switchItemGame}
      quotaNote={quotaNote ?? (outOfScans ? "You're out of scans. Tap Capture to get more." : null)}
      onGetMore={outOfScans ? getMoreScans : undefined}
      onSwap={swapCard}
      onCapture={onCameraCapture}
      onClose={closeCamera}
      onOpen={(id) => {
        setSelectedId(id);
        closeCamera();
      }}
      onEdit={editCopy}
      onApplyConditionToAll={
        items.filter((i) => i.kind !== "sealed" && !i.grading && !i.verifiedAt && i.status !== "listed" && i.status !== "sold").length > 1
          ? applyConditionToAll
          : undefined
      }
    />
  );

  const identified = items.filter((i) => i.card);
  const readyCount = items.filter((i) => i.status === "ready").length;
  const soldItems = items.filter((i) => i.status === "sold");
  const listedItems = items.filter((i) => i.status === "listed");
  const pendingValue = items
    .filter((i) => i.status !== "sold")
    .reduce((sum, item) => sum + headlinePrice(item), 0);
  const totalEarned = soldItems.reduce((sum, item) => sum + currentPrice(item), 0);

  const selected = items.find((i) => i.id === selectedId) ?? null;

  // "Next card →" on the Listed/Sold receipts: the nearest card still being
  // worked, so a stack session never needs a sidebar hunt between publishes.
  const nextWorkable = items.find(
    (i) => i.id !== selectedId && (i.status === "ready" || i.status === "review"),
  );
  const selectNext = nextWorkable ? () => setSelectedId(nextWorkable.id) : null;

  // "Apply to every card in the queue" under the condition select: one grade
  // for the whole box. Finished (listed/sold) and graded-slab items keep
  // theirs; ledger rows sync like a single edit would.
  /**
   * The result card's "This copy" sheet (10-15): a condition or printing
   * change from the camera. Same as the editor's: the item, and when the card
   * is already on the server its ledger condition + re-quoted price.
   */
  // Hoisted (function, not const): the camera element above refers to it.
  function editCopy(id: string, patch: Partial<ScanItem>) {
    const item = itemsRef.current.find((i) => i.id === id);
    if (!item) return;
    patchItem(id, patch);
    if (!item.serverId) return;
    const next = { ...item, ...patch } as ScanItem;
    const requote = !next.grading ? quoteForItem({ ...next, priceOverride: null })?.suggested : undefined;
    void updateServerCard(item.serverId, {
      condition: describeItemCondition(next),
      ...(requote ? { price: requote, priceLocked: false } : {}),
    });
  }

  function applyConditionToAll(condition: Condition) {
    let touched = 0;
    const next = itemsRef.current.map((item) => {
      if (item.kind === "sealed" || item.grading) return item;
      if (item.status === "listed" || item.status === "sold") return item;
      // Review 10-19 #7: "waiting" = not verified yet. A card the seller already checked keeps its grade, and a
      // price they typed survives (only a quoted price follows the new condition).
      if (item.verifiedAt) return item;
      if (item.condition === condition) return item;
      touched++;
      const next = { ...item, condition };
      if (item.serverId) {
        // Ledger price follows the condition, same as a single edit.
        const requote = item.priceOverride == null ? quoteForItem(next)?.suggested : undefined;
        void updateServerCard(item.serverId, {
          condition: describeItemCondition(next),
          ...(requote ? { price: requote, priceLocked: false } : {}),
        });
      }
      return next;
    });
    if (touched > 0) {
      commit(next);
      toast(`${condition} set on ${touched} card${touched === 1 ? "" : "s"}`);
    }
  }

  return (
    <>
      {quotaNote && (
        <div
          role="alert"
          className="mx-auto mt-4 flex w-full max-w-7xl items-center justify-between gap-3 rounded-2xl border border-red-400/20 bg-red-400/10 px-5 py-3 text-sm text-red-200 sm:px-6"
        >
          <span>
            <span className="font-semibold text-red-300">{quotaNote}</span>{" "}
            <Link
              href="/app/account"
              className="font-medium text-white underline underline-offset-4 transition hover:text-red-100"
            >
              See Your Plan
            </Link>{" "}
            <Link
              href="/help#scan-limits"
              className="font-medium text-red-200/80 underline underline-offset-4 transition hover:text-red-100"
            >
              How Limits Work
            </Link>
          </span>
          <button
            onClick={() => {
              quotaNoteDismissed.current = true;
              setQuotaNote(null);
            }}
            aria-label="Dismiss"
            className="text-red-300/70 transition hover:text-red-200"
          >
            ✕
          </button>
        </div>
      )}

      {ebayJustConnected && (
        <div
          role="status"
          className="mx-auto mt-4 flex w-full max-w-7xl items-center justify-between gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-3 text-sm text-emerald-200 sm:px-6"
        >
          <span>
            <span className="font-semibold text-emerald-300">eBay connected.</span>{" "}
            Scan a card and use <span className="font-medium text-white">Send draft to eBay</span> — nothing goes live until you publish.
          </span>
          <button
            onClick={() => setEbayJustConnected(false)}
            aria-label="Dismiss"
            className="text-emerald-300/70 transition hover:text-emerald-200"
          >
            ✕
          </button>
        </div>
      )}

      {/* Saved cards, not captures: items.length moved before the server row existed, so the bar said 2 pulls for 3 (Chris 10-12). */}
      <ActivePackBar userId={user?.id} refreshKey={items.filter((i) => i.serverId).length} onGame={setGame} />

      {resuming && items.length === 0 ? (
        // Reopening from My cards: a quiet loader instead of flashing the
        // first-scan hero for the second the rebuild takes.
        <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
          <StagedProgress
            title={resumeHint.name ? `Reopening ${resumeHint.name}…` : "Reopening your cards…"}
            steps={RESUME_STEPS}
            stageMs={RESUME_STAGE_MS}
            image={resumeHint.image}
          />
        </main>
      ) : items.length === 0 ? (
        // Top-anchored, not vertically centered: centering pushed the hero
        // halfway down a desktop viewport and left a wall of empty space
        // above it (Chris, 09-01).
        <main className="flex flex-1 flex-col items-center gap-4 px-4 pb-12 pt-4 sm:gap-6 sm:pt-8">
          {/* Empty scanner (09-30 makeover, Chris: "seems old and outdated"):
              an app screen, not a landing page. The marketing headline and the
              1-2-3 step chips are gone (the landing page sells; this screen
              scans): the game switch, then the viewfinder and its buttons. */}
          <h1 className="sr-only">Scanner</h1>
          <PhoneHint />
          <div className="w-full max-w-md">
            <GameToggle game={game} onChange={setGame} block />
          </div>
          {/* Seller · Collector here too (Chris, 10-05): a collector can drop the eBay bits before the first scan. */}
          <div data-tour="mode-switch">
            <PricingModeToggle />
          </div>
          <Uploader onOpenCamera={openCamera} showcase={showcase} game={game} />
          {/* The add-without-a-photo search and sealed-product rows were
              removed 09-01 (Chris), photo uploads, binder pages and the
              sealed sheet 10-03: eBay listings must show the actual item, so
              every card starts from a camera scan now. The Open a Pack button
              went 10-16 (Chris). */}
        </main>
      ) : (
        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
          {/* Queue summary (09-28 makeover, Chris: "taking up a lot of space
              and kinda sloppy"): two tight rows on a phone — the numbers with
              the eBay button on the first, the two worded Add buttons on the
              second — and one row on desktop (the phone wrappers dissolve
              with sm:contents). Display type for the values. */}
          <div className="flex flex-col gap-3 rounded-2xl border border-edge bg-surface-1 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-5 sm:py-4">
            {/* Phone (10-11, Chris: the headline wrapped into four ragged lines beside the eBay
                button): headline and sub-line never wrap, the button and the X are a notch smaller. */}
            <div className="flex flex-wrap items-center justify-between gap-2 sm:contents">
            <div className="flex min-w-0 items-end gap-x-6 gap-y-1 sm:flex-wrap">
              <div className="min-w-0">
                <p className="whitespace-nowrap font-display text-lg font-semibold leading-none text-white sm:text-xl">
                  {items.length} card{items.length === 1 ? "" : "s"}
                  {/* Phones fold the value into the headline; desktop has its own stat. */}
                  <span className="sm:hidden"> · {formatMoney(pendingValue)}</span>
                </p>
                <p className="mt-1 truncate whitespace-nowrap text-xs text-zinc-400" aria-live="polite">
                  {readyCount} ready · {listedItems.length} live · {items.length - identified.length} pending
                </p>
              </div>
              <div className="hidden sm:block">
                <p className="font-display text-xl font-semibold leading-none text-white">{formatMoney(pendingValue)}</p>
                <p className="mt-1 text-xs text-zinc-400">In progress</p>
              </div>
              {scanUsage && scanUsage.remaining !== null && (
                <div className="hidden sm:block">
                  {/* Phones already show the meter in the header. */}
                  <p
                    className={`font-display text-xl font-semibold leading-none ${
                      scanUsage.remaining <= 0 ? "text-red-400" : scanUsage.remaining <= 50 ? "text-amber-300" : "text-white"
                    }`}
                  >
                    {scanUsage.remaining}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">Scans left</p>
                </div>
              )}
              {soldItems.length > 0 && (
                <div className="hidden animate-fade-up sm:block">
                  <p className="font-display text-xl font-semibold leading-none text-emerald-400">{formatMoney(totalEarned)}</p>
                  <p className="mt-1 text-xs text-zinc-400">Sold ({soldItems.length})</p>
                </div>
              )}
            </div>
              {/* Phone: the button and the X move as a pair, dropping under a wide headline
                  ("12 cards · $1,234.56") instead of squeezing it. Desktop: dissolved. */}
              <div className="ml-auto flex shrink-0 items-center gap-2 sm:contents">
              {user.role !== "admin" && user.tier === "trial" && !user.ebayConnected ? (
                // Trial: selling is paid, so the one action here is Subscribe
                // (Chris, 09-06) — the plans page, not the eBay consent screen.
                <Link
                  href="/pricing"
                  className={`${TAP_8} shrink-0 whitespace-nowrap rounded-full bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-400 sm:order-last sm:px-4 sm:py-2 sm:text-sm`}
                >
                  Subscribe Now
                </Link>
              ) : user.pricingOnly ? null : (
                // Pricing only (10-04): no Send to eBay.
                <button
                  onClick={() => void sendAllToEbay()}
                  disabled={bulkBusy || identified.length === 0}
                  title={user.ebayConnected ? "Send every verified card to your eBay account" : "Connect your eBay account first"}
                  className={`${TAP_8} shrink-0 whitespace-nowrap rounded-full bg-ebay px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-ebay-hover disabled:cursor-not-allowed disabled:opacity-40 sm:order-last sm:px-4 sm:py-2 sm:text-sm`}
                >
                  {bulkBusy ? "Sending…" : user.ebayConnected ? "Send to eBay" : "Connect eBay"}
                </button>
              )}
              {selected && (
                // Close the open card after the action button so it sits at the far right (Chris 10-08: "looks weird in the center"; "a close button … to close the scan out and take you to the inventory page").
                <button
                  type="button"
                  // The X closes the scan and lands on Inventory (Chris 10-08: "it just blanks out the card below").
                  // The card stays on screen until Inventory is up (Chris 10-12: clearing it first made the X vanish
                  // and the panel blank for a beat before the page changed, which read as lag).
                  // A word, not an X (10-14, Jenny): the top X and the row Xs read as the same thing, and the row
                  // ones deleted cards. "Done" says what this one does: finished scanning, go to Inventory.
                  onClick={() => router.push("/app/collection")}
                  aria-label="Done, go to Inventory"
                  title="Done, go to Inventory"
                  className={`${TAP_8} flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border border-edge px-3 text-xs font-semibold text-zinc-200 transition hover:border-brand-400 hover:text-white sm:order-last sm:h-9 sm:px-4 sm:text-sm`}
                >
                  Done
                </button>
              )}
              </div>
            </div>

            {/* Phones: five game pills no longer share a row with the two Add
                buttons (10-02, iPhone: Add Cards / Add Sealed ran off the page
                once Lorcana, One Piece and Yu-Gi-Oh joined) — pills on one
                line, the buttons under them. Desktop: unchanged (contents). */}
            <div className="flex flex-col gap-2 sm:contents">
              {/* Centred on the phone (10-11, Chris: "center games at the top"). */}
              <div className="flex justify-center sm:contents">
                <GameToggle game={game} onChange={setGame} compact />
              </div>
              {/* Add Cards + Inventory on one row (10-11, Chris: the three-item row was crowded
                  and cut off, and Seller · Collector does not belong up here; it still lives on
                  the pre-scan screen, Account and Inventory). */}
              <div className="grid grid-cols-2 gap-2 sm:contents">
                <Uploader onOpenCamera={openCamera} variant="compact" />
                <Link
                  href="/app/collection"
                  className="relative whitespace-nowrap rounded-full border border-edge bg-surface-1 px-4 py-2 text-center text-sm font-medium text-zinc-200 transition before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] hover:border-brand-400 hover:text-white"
                >
                  Inventory →
                </Link>
              </div>
            </div>
          </div>
          {bulkNote && (
            <p role="status" className="-mt-2 px-1 text-xs text-zinc-400">
              {bulkNote}{" "}
              {bulkFailedIds.length > 0 && !bulkBusy && (
                <button
                  onClick={() => void sendAllToEbay(bulkFailedIds)}
                  className="font-medium text-zinc-200 underline underline-offset-4 transition hover:text-white"
                >
                  Retry failed ({bulkFailedIds.length})
                </button>
              )}{" "}
              {items.some((item) => item.ebayDraftUrl) && (
                <a
                  href={EBAY_DRAFTS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-zinc-200 underline underline-offset-4 transition hover:text-white"
                >
                  View My eBay Drafts ↗
                </a>
              )}
            </p>
          )}

          {/* Both grid children carry min-w-0 (10-02, iPhone): a grid item's default
              min-width is its content, so the queue and the editor grew to the
              viewport width (390 in a 358 column), 16px past the right edge, and
              iOS let the whole page pan sideways. */}
          <div className="grid flex-1 gap-4 lg:grid-cols-[320px_1fr]">
            {/* On a phone the queue sits above the editor — capped low so the
                card being edited starts on screen instead of under a
                70dvh-tall list (the queue scrolls within itself). */}
            {/* The queue pins to the viewport and scrolls inside itself on desktop, so
                picking the next card never means scrolling away from the listing
                and back (Chris, 09-03). Phones keep the short strip above the editor. */}
            <aside className="flex min-w-0 max-h-[32dvh] flex-col gap-1 overflow-y-auto rounded-2xl border border-edge bg-surface-1 p-2 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:self-start">
              {items.map((item) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  onSelect={() => setSelectedId(item.id)}
                  onRemove={() => clearItem(item.id)}
                />
              ))}
            </aside>

            {/* A flex column so the Share row below the editor stays inside the box: the Listed panel is h-full, and
                with the section stretched to its grid row that pushed Share past the border onto the footer text
                (Chris 10-12, iPhone). The editor fills the flex-1 wrapper instead. */}
            <section className={`flex min-w-0 flex-col rounded-2xl border border-edge bg-surface-1 ${selected ? "min-h-[24rem]" : "min-h-[24rem] max-sm:min-h-0"}`}>
              <div className="min-h-0 flex-1">
              {selected ? (
                selected.kind === "sealed" ? (
                  <SealedEditor
                    key={selected.id}
                    item={selected}
                    ebayConnected={user.ebayConnected}
                    onChange={(patch) => patchItem(selected.id, patch)}
                  />
                ) : (
                  <CardEditor
                    key={selected.id}
                    item={selected}
                    ebayConnected={user.ebayConnected}
                    onChange={(patch) => {
                      // Re-queue (Scan again) or a picked card revives a row the watchdog gave up on.
                      if (patch.status === "queued" || patch.card) abandoned.current.delete(selected.id);
                      const newCard = patch.card && patch.card.id !== selected.card?.id ? patch.card : null;
                      // A chart point carries no card id, so the old card's point would price the new one
                      // (10-20: the D23 promo's point on Angel #25). It goes with the card; the editor's
                      // hook stores the new card's point when it loads.
                      // The seller's pick also ends a picture tiebreak still out (printingCheck).
                      patchItem(selected.id, newCard ? { ...patch, ...("currentPoint" in patch ? {} : { currentPoint: undefined }), printingCheck: undefined } : patch);
                      // A different catalog card (candidate pick, name
                      // search, 1st Edition ↔ unlimited swap) is a different
                      // product: the ledger row follows it, so Inventory
                      // shows the right name, set, image, 1st Edition pill and price.
                      if (newCard && selected.serverId) {
                        const next = itemsRef.current.find((i) => i.id === selected.id);
                        void updateServerCard(selected.serverId, {
                          cardName: newCard.englishName || newCard.name,
                          setName: newCard.setName,
                          cardNumber: newCard.number,
                          imageUrl: newCard.imageSmall,
                          catalogCardId: newCard.id || null,
                          rarity: newCard.rarity ?? null,
                          firstEdition: isFirstEditionCard(newCard),
                          ...(next ? ledgerPriceForNewCard(next) : null),
                          scanMarket: next ? headlinePrice(next) || null : null,
                        });
                      }
                    }}
                    onNext={selectNext}
                    onRemove={() => void deleteItem(selected.id)}
                    onSwitchGame={(to) => switchItemGame(selected.id, to)}
                    onApplyConditionToAll={
                      items.filter(
                        (i) =>
                          i.kind !== "sealed" &&
                          !i.grading &&
                          !i.verifiedAt &&
                          i.status !== "listed" &&
                          i.status !== "sold",
                      ).length > 1
                        ? applyConditionToAll
                        : undefined
                    }
                  />
                )
              ) : (
                <div className="flex h-full items-center justify-center p-6 sm:p-8 text-sm text-zinc-500">
                  {user.pricingOnly ? "Select a card to see its price." : "Select a card to review its listing."}
                </div>
              )}
              </div>
              {selected && selected.kind !== "sealed" && selected.card?.id && !selected.grading && (
                <div className="flex shrink-0 justify-end border-t border-edge px-4 py-2.5">
                  <ShareImageButton
                    path={`/api/share/card?game=${selected.card.game ?? "pokemon"}&id=${encodeURIComponent(cardKey(selected.card.game ?? "pokemon", { id: selected.card.id, setCode: selected.card.setCode, number: selected.card.number }))}`}
                    fileName="cardflip-card"
                  />
                </div>
              )}
            </section>
          </div>

          <p className="text-center text-xs text-zinc-600">
            {user.pricingOnly
              ? "Every card you scan is saved to your Inventory at today's market price."
              : user.ebayConnected
              ? "Drafts post straight to your eBay account. Nothing goes live until you publish."
              : user.role !== "admin" && user.tier === "trial"
              ? "Selling on eBay comes with a plan. Subscribe and every card lists from here."
              : "Connect your eBay account once and every card lists from here — draft, then publish."}
          </p>
        </main>
      )}
      {camera}
      {categoryPrompt && (
        <CategorySheet
          title="Which category?"
          hint="The cards you just scanned are filed here in Inventory. You can move them later."
          categories={distinctCategories([...categoryPrompt.existing.map((c) => ({ category: c })), { category: scanCategory }])}
          current={scanCategory}
          confirmLabel="File them here"
          onClose={() => setCategoryPrompt(null)}
          onPick={(category) => {
            setScanCategory(category);
            saveCategory(user?.id, category, game);
            setCategoryPrompt(null);
            // Cards already saved this session (the scan beat the answer)
            // follow the pick; unsaved ones read the ref at create time.
            for (const itemId of sessionItemIdsRef.current) {
              const it = itemsRef.current.find((i) => i.id === itemId);
              if (it?.serverId) void updateServerCard(it.serverId, { category: resolveCategory(category, it.game, it.card?.setName, knownCategoriesRef.current) });
            }
          }}
          auto="replace"
        />
      )}
    </>
  );
}
