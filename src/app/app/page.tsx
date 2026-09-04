"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { lastRecordedPoint } from "@/components/PriceHistoryChart";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Uploader from "@/components/Uploader";
import GameToggle from "@/components/GameToggle";
import type { ShowcaseCard } from "@/components/Uploader";
import CameraCapture from "@/components/CameraCapture";
import StagedProgress from "@/components/StagedProgress";
import QueueRow from "@/components/QueueRow";
import CardEditor from "@/components/CardEditor";
import SealedEditor from "@/components/SealedEditor";
import PageSkeleton from "@/components/PageSkeleton";
import { useSession } from "@/components/SessionProvider";
import { scanCard } from "@/lib/ocr";
import { fetchCardById, searchCards } from "@/lib/cards";
import { isSecretRareNumber, normalizeNumber, pickPrinting, type PrintedNumber } from "@/lib/cardNumber";
import { buildListing, buildSealedListing, canBeFirstEdition, isFirstEditionCard, itemFirstEdition, withListingOverrides, currentPrice, describeItemCondition, effectiveVariant, mtgFinishOf, quotePrice, withEbayPrices, quoteForItem } from "@/lib/listing";
import { parseGradeQuery } from "@/lib/grading";
import { readSavedGame, saveGame } from "@/lib/games";
import { readSavedCategory, readSavedCondition, readSavedStrategy, saveCategory } from "@/lib/client/scanPrefs";
import CategorySheet, { distinctCategories } from "@/components/CategorySheet";
import {
  createServerCard,
  type ServerCard,
  deleteServerCard,
  fetchServerCards,
  updateServerCard,
} from "@/lib/client/cardsApi";
import { toast } from "@/components/Toaster";
import { apiPath } from "@/lib/client/basePath";
import { saveQueue } from "@/lib/client/queuePersistence";
import { EBAY_DRAFTS_URL, fetchEbayComps, sendEbayDraft } from "@/lib/client/ebayApi";
import { uploadCardPhoto } from "@/lib/client/cardPhotoApi";
import { scanCardWithVision, type ScanUsage } from "@/lib/client/visionApi";
import { primeScanFx } from "@/lib/client/scanFx";
import { CONDITIONS } from "@/lib/listing";
import { LOW_CONFIDENCE, UNREADABLE_CONFIDENCE } from "@/lib/types";
import type {
  ArtStyle,
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
  candidates: results,
  card,
  grading,
  firstEdition: row.firstEdition,
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

/** Concurrent scans per tab — see pumpingRef. */
const SCAN_WORKERS = 2;

/* Reopen tracker: the ledger fetch and catalog match run in parallel and
   usually land inside two seconds; the last step holds until they do. */
const RESUME_STEPS = ["Finding the match", "Pulling today's prices", "Loading your photo"] as const;
const RESUME_STAGE_MS = [900, 2000] as const;

export default function AppPage() {
  const router = useRouter();
  const { user, refresh } = useSession();

  const [items, setItems] = useState<ScanItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // English-only for now — the ja/zh pipeline underneath still works;
  // restoring <LanguageToggle> here re-enables it.
  const language: ScanLanguage = "en";
  // Which game the scanner reads: Pokémon or Magic. Remembered per browser;
  // every item entering the queue carries the game it was scanned under, so
  // switching mid-session doesn't relabel what's already there.
  // The stage's real card (empty state only). One fetch, cached an hour
  // server-side; a miss just leaves the stage as the buttons.
  const [showcase, setShowcase] = useState<ShowcaseCard[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(apiPath("/api/cards/featured"))
      .then((r) => (r.ok ? r.json() : { cards: [] }))
      .then((d) => {
        if (!cancelled) setShowcase(Array.isArray(d.cards) ? d.cards : []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const [game, setGameState] = useState<GameId>(readSavedGame);
  const setGame = useCallback((next: GameId) => {
    setGameState(next);
    saveGame(next);
  }, []);
  // Lives here rather than in Uploader: the first capture swaps the page from
  // the hero layout to the queue layout, and the viewfinder must survive that.
  const [cameraOpen, setCameraOpen] = useState(false);
  // Category new cards are filed under (Chris, 09-04): asked when the camera
  // opens, remembered per browser, rides on every createServerCard.
  const [scanCategory, setScanCategory] = useState<string | null>(readSavedCategory);
  const scanCategoryRef = useRef<string | null>(null);
  useEffect(() => {
    scanCategoryRef.current = scanCategory;
  }, [scanCategory]);
  const [categoryPrompt, setCategoryPrompt] = useState<{ existing: string[] } | null>(null);
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
    saveQueue(next);
  }, []);

  const patchItem = useCallback(
    (id: string, patch: Partial<ScanItem>) => {
      commit(
        itemsRef.current.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      );

      // Ready/listed/sold are the checkpoints an admin actually cares about
      // seeing — field-by-field edits before that stay client-only until one
      // of those checkpoints is hit, so we're not round-tripping on keystroke.
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item?.serverId) return;

      if (patch.status === "listed") {
        void updateServerCard(item.serverId, {
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
        void updateServerCard(item.serverId, {
          status: "sold",
          soldPrice: item.soldPrice,
          soldAt: item.soldAt,
          condition: describeItemCondition(item),
        });
      } else if (patch.status === "ready" && "listedAt" in patch) {
        void updateServerCard(item.serverId, { status: "ready", listedAt: null });
      }
      // Verification is its own checkpoint: it's what unlocks publishing,
      // and it has to outlive this tab (My Cards shows it).
      if ("verifiedAt" in patch || "matchDoubt" in patch) {
        void updateServerCard(item.serverId, {
          ...("verifiedAt" in patch ? { verifiedAt: patch.verifiedAt ?? null } : {}),
          ...("matchDoubt" in patch ? { matchDoubt: patch.matchDoubt ?? null } : {}),
        });
      }
    },
    [commit],
  );

  // OCR is the fallback behind vision, so its worker + model (several MB of
  // WASM and traineddata) load on first use, not on every scanner mount —
  // eagerly warming it competed with the resume/scan requests for a phone's
  // bandwidth and CPU for nothing in the common case (09-02 clunkiness pass).

  // Fresh scanner every visit (Chris, 08-27: "i want fresh starts"). The
  // queue used to rebuild itself from the saved snapshot after a refresh,
  // re-opening the previous session's cards every time the app opened. The
  // ledger (collection page) already keeps every card that reached the
  // server, so nothing is lost by starting empty -- the snapshot is cleared
  // on arrival so there is never anything to restore.
  useEffect(() => {
    saveQueue([]);
  }, []);

  // Release the object URLs held by previews when the page goes away.
  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  const pump = useCallback(async () => {
    if (pumpingRef.current >= SCAN_WORKERS) return;
    pumpingRef.current++;

    try {
      for (;;) {
        const next = itemsRef.current.find((i) => i.status === "queued");
        if (!next) break;

        // Search-added items are born "ready" and never enter the queue; a
        // queued item without a file would otherwise loop here forever.
        if (!next.file) {
          patchItem(next.id, { status: "error", error: "No photo attached" });
          continue;
        }

        patchItem(next.id, { status: "scanning" });
        // More waiting and a free worker slot: run them side by side. The
        // claim above is synchronous (commit writes itemsRef), so two
        // workers can never pick the same item.
        if (itemsRef.current.some((i) => i.status === "queued")) void pump();

        try {
          // Vision first, OCR as the fallback. Tesseract misreads CJK badly
          // enough that the lookup needs fuzzy matching to cope; when vision
          // is available it reads the card directly and that guesswork goes away.
          const vision = await scanCardWithVision(next.file, next.language, next.game);

          if (vision.usage) setScanUsage(vision.usage);
          // A trial that just ran out: re-read the session so the
          // SubscriptionGate swaps the scanner for the paywall.
          if (vision.status === "quota") void refresh();
          if (vision.status === "quota" && !quotaNoteDismissed.current) {
            setQuotaNote(
              vision.error ??
                "You've used all your scans this month — cards still scan by OCR, which reads less of the card.",
            );
          }

          let nameCandidates: string[];
          let printed: PrintedNumber | null;
          let language = next.language;
          // Frame style from the photo — the tiebreak that keeps a full-art
          // card off its promo/regular printing when the number is unread.
          let art: ArtStyle = null;
          let readError: string | null = null;
          // MTG Art Series: vision flagged it, so only art sets may answer.
          let artOnly = false;
          let artMiss: string | null = null;

          if (vision.status === "done" && vision.read) {
            const read = vision.read;
            // The photo outranks the seller's language toggle — stacks get sorted wrong.
            language = read.language;
            art = read.artStyle ?? null;
            nameCandidates = [read.name, read.englishName].filter(
              (n): n is string => Boolean(n),
            );
            // Vision reads the set symbol and the whole fraction, which is what
            // settles an original against a same-numbered reprint.
            printed = read.cardNumber
              ? {
                  number: read.cardNumber,
                  setTotal: read.setTotal,
                  setCode: read.setCode,
                  isSecretRare: isSecretRareNumber(read.cardNumber, read.setTotal),
                }
              : null;

            const condition = asCondition(read.condition);
            patchItem(next.id, {
              vision: read,
              visionStatus: "done",
              language,
              ...(condition ? { condition } : {}),
            });

            // Two reads that must not become a guess (Chris's 09-03 MTG stress
            // test): a near-zero confidence read ("Unknown", 5%) whose one
            // word prefix-matched a real card, and Magic TOKENS (collector
            // number "T 0016") that aren't in the mirror and rode a
            // substring onto a priced card. Say what happened instead.
            // Art cards carry no number, so the model rates its name+number
            // confidence low even when the name is plain — the floor applies
            // to real cards only.
            if (typeof read.confidence === "number" && read.confidence < UNREADABLE_CONFIDENCE && read.kind !== "art") {
              readError = `Couldn't read this card (${Math.round(read.confidence * 100)}% sure) — retake with the whole card in the guide and no glare`;
              nameCandidates = [];
              printed = null;
            } else if (
              next.game === "mtg" &&
              (read.kind === "token" || (read.cardNumber && /^T\s*\d+$/i.test(read.cardNumber.trim())))
            ) {
              readError = "That's a token — tokens aren't priced or listed";
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
          } else {
            patchItem(next.id, { visionStatus: vision.status });
            const scan = await scanCard(next.file, next.language);
            nameCandidates = scan.nameCandidates;
            printed = scan.printed;
          }

          let matches: Awaited<ReturnType<typeof searchCards>> = [];
          // One flaky request shouldn't end the scan while a later candidate
          // would have matched, so a failed lookup moves on to the next name
          // and only counts as an outage if every one of them failed.
          let lookupErrors = 0;

          // Substring hits are not a reason to stop: three stray letters of
          // OCR debris can "match" two dozen unrelated cards (a foil Mewtwo
          // once came back as Illumise this way) while the candidate that
          // names the card exactly sits later in the list. A non-exact result
          // is only a fallback; the walk ends early on an exact name.
          for (const candidate of nameCandidates) {
            try {
              const found = await searchCards(candidate, printed, language, undefined, next.game, art, artOnly, vision.read?.firstEdition ?? null);
              if (found.length === 0) continue;
              if (matches.length === 0) matches = found;
              if (
                found[0].name.trim().toLowerCase() ===
                candidate.trim().toLowerCase()
              ) {
                matches = found;
                break;
              }
            } catch {
              lookupErrors++;
            }
          }

          // Every name missed, but the fraction came off a different band of
          // the card and can identify it alone — glare on the name is exactly
          // when this is worth trying, and it costs one request.
          // (Pokémon: number + set total; MTG: number + printed set code.)
          const numbersIdentify =
            next.game === "mtg"
              ? Boolean(printed?.setCode)
              : Boolean(printed?.setTotal) && language === "en";
          if (matches.length === 0 && printed && numbersIdentify) {
            try {
              matches = await searchCards("", printed, language, undefined, next.game, null, false, vision.read?.firstEdition ?? null);
            } catch {
              lookupErrors++;
            }
          }

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
              error: "Card lookup is down right now — search by name to retry",
            });
          } else if (matches.length === 0) {
            patchItem(next.id, {
              status: "review",
              candidates: [],
              card: null,
              error: readError ?? artMiss ?? "No match found — search by name",
            });
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
            patchItem(next.id, {
              status: lowConfidence || ambiguous || numberMismatch ? "review" : "ready",
              candidates: matches,
              card,
              // 1st Edition is its own catalog card (the "-1st" twin); the
              // stamp vision read chose it in the search ranking above.
              firstEdition: isFirstEditionCard(card),
              error: null,
              matchDoubt: lowConfidence
                ? `low-confidence read (${Math.round((vision.read?.confidence ?? 0) * 100)}%)`
                : numberMismatch
                  ? `read #${printed!.number}, closest printing is #${card.number}`
                  : ambiguous
                    ? `${matches.length} printings matched, no number read`
                    : null,
            });

            // Vision may already have graded the card, so read the condition
            // back off the item rather than assuming Near Mint.
            const condition =
              itemsRef.current.find((i) => i.id === next.id)?.condition ?? "Near Mint";
            const quote = quotePrice(card, condition, "quick");
            const input = {
              cardName: card.englishName || card.name,
              setName: card.setName,
              cardNumber: card.number,
              imageUrl: card.imageSmall,
              condition,
              price: quote?.suggested ?? 0,
              game: next.game,
              catalogCardId: card.id || null,
              rarity: card.rarity ?? null,
              category: scanCategoryRef.current,
            };
            // Without a server row the card can't be published or appear in
            // the collection — one retry covers the usual flaky-network blip.
            const server = (await createServerCard(input)) ?? (await createServerCard(input));
            if (server) {
              patchItem(next.id, { serverId: server.id });
              // Verified before the row existed (fast tap): sync it now.
              const cur = itemsRef.current.find((i) => i.id === next.id);
              if (cur?.verifiedAt || cur?.matchDoubt || cur?.firstEdition) {
                void updateServerCard(server.id, {
                  ...(cur.verifiedAt ? { verifiedAt: cur.verifiedAt } : {}),
                  ...(cur.matchDoubt ? { matchDoubt: cur.matchDoubt } : {}),
                  ...(cur.firstEdition ? { firstEdition: true } : {}),
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
        }
      }
    } finally {
      pumpingRef.current--;
    }
  }, [patchItem, refresh]);

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

  const loadEbayComps = useCallback(
    async (id: string, card: PokemonCard, firstEditionOverride?: boolean) => {
      compsInFlight.current.add(id);
      patchItem(id, { ebayStatus: "loading" });
      // The point rides alongside the comps; whichever lands second re-saves
      // the price, so the ledger ends up on the same number as the screen.
      void loadCurrentPoint(id, card);

      try {
        // 1st Edition copies are their own eBay market — the comps are pulled
        // for the printing the item claims to be (stamped listings excluded
        // for an unlimited copy of a set that had a run).
        const current = itemsRef.current.find((i) => i.id === id);
        const stamped = firstEditionOverride ?? (current ? itemFirstEdition(current) : false);
        const result = await fetchEbayComps(card, null, canBeFirstEdition(card) ? stamped : null);
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
    const hintName = params.get("rn");
    const hintNumber = params.get("rnum");
    const hintGame = params.get("rg") === "mtg" ? "mtg" : "pokemon";
    const hintPhotoAt = params.get("rp");
    const hintImage = params.get("ri");
    window.history.replaceState(null, "", window.location.pathname);
    void (async () => {
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
      const eagerSearch = hintName
        ? searchCards(hintName, hintNumber || null, "en", undefined, hintGame).catch(() => null)
        : null;
      const rows = await fetchServerCards();
      const wanted = resumeIds
        .map((id) => rows.find((r) => r.id === id))
        .filter((r): r is ServerCard => Boolean(r) && r!.kind !== "sealed" && r!.status !== "sold");
      if (wanted.length === 0) {
        setResuming(false);
        toast(resumeIds.length === 1 ? "Couldn't reopen that card here — scan it again" : "Couldn't reopen those cards here");
        return;
      }
      // The eager result is only trusted when the hint matches the row (a
      // stale or hand-edited link falls back to the exact lookup). Hints
      // only ride along on single-card links.
      const build = async (row: ServerCard): Promise<ScanItem | null> => {
        const game = row.game === "mtg" ? "mtg" : "pokemon";
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
        toast("Couldn't look those cards up again — scan them to rebuild the listings");
        return;
      }
      if (items.length < wanted.length) {
        toast(`${wanted.length - items.length} card${wanted.length - items.length === 1 ? "" : "s"} couldn't be looked up again`);
      }
      commit([...itemsRef.current, ...items]);
      setSelectedId(items[0].id);
      setResuming(false);
      for (const item of items) {
        if (item.status !== "listed" && item.card) void loadEbayComps(item.id, item.card);
        // The id fetch above is why reopening is instant, but it leaves the
        // item with a single candidate — and "Not your card? N other
        // matches" is gated on having more than one (09-04: the link was
        // gone on every resumed card). Fill the alternatives behind the
        // scenes; the card itself stays what the ledger row points at.
        if (item.card && item.candidates.length <= 1 && !item.verifiedAt) {
          const { id, card } = item;
          void searchCards(card.englishName || card.name, card.number || null, "en", undefined, item.game)
            .then((found) => {
              const cur = itemsRef.current.find((i) => i.id === id);
              if (!cur || cur.card?.id !== card.id || cur.candidates.length > 1) return;
              const others = found.filter((c) => c.id !== card.id);
              if (others.length > 0) patchItem(id, { candidates: [card, ...others] });
            })
            .catch(() => {});
        }
      }
    })();
  }, [commit, loadEbayComps, patchItem]);


  const openCamera = useCallback(() => {
    // A toast left over from the previous session would flash a stale result.
    setCameraItemId(null);
    // Inside the tap, so the scan sounds are allowed to play later.
    void primeScanFx();
    categoryAskedRef.current = false;
    sessionItemIdsRef.current = [];
    setCameraOpen(true);
  }, []);

  /** Photo uploads (QA leftover): same category ask as the first camera
   *  capture, once per session; the picked category reaches every card
   *  added this session, saved or not yet. */
  const addUploads = useCallback(
    (files: File[]) => {
      const ids = addFiles(files);
      sessionItemIdsRef.current.push(...ids);
      if (ids.length > 0 && !categoryAskedRef.current) {
        categoryAskedRef.current = true;
        setCategoryPrompt({ existing: [] });
        void fetchServerCards().then((rows) => {
          setCategoryPrompt((p) => (p ? { existing: distinctCategories(rows) } : p));
        });
      }
      return ids;
    },
    [addFiles],
  );

  /** Captures file silently; the category ask waits for Done (Chris,
   *  09-04: the sheet was covering the card the scanner had just found). */
  const onCameraCapture = useCallback(
    (file: File) => {
      const id = addFiles([file])[0] ?? null;
      setCameraItemId(id);
      if (id) sessionItemIdsRef.current.push(id);
    },
    [addFiles],
  );

  /** Camera closed: if this session scanned anything and hasn't been asked
   *  yet, ask "which category?" now, over the queue — never over the reveal. */
  const closeCamera = useCallback(() => {
    setCameraOpen(false);
    if (sessionItemIdsRef.current.length > 0 && !categoryAskedRef.current) {
      categoryAskedRef.current = true;
      setCategoryPrompt({ existing: [] });
      void fetchServerCards().then((rows) => {
        setCategoryPrompt((p) => (p ? { existing: distinctCategories(rows) } : p));
      });
    }
  }, []);

  // Removal is undoable (Chris, 09-01 QoL pass): the ✕ used to hard-delete
  // the server card instantly — a misclick on a priced, photographed card was
  // unrecoverable. Now the row leaves the queue at once, but the server
  // delete (and preview-URL revoke) waits out the undo window; Undo just
  // puts the captured item back. Pending deletes are flushed if the page
  // unmounts before their timers fire, so nothing silently survives.
  const pendingRemovals = useRef(
    new Map<string, { item: ScanItem; index: number; timer: ReturnType<typeof setTimeout> }>(),
  );
  const finalizeRemoval = useCallback((id: string) => {
    const pending = pendingRemovals.current.get(id);
    if (!pending) return;
    pendingRemovals.current.delete(id);
    clearTimeout(pending.timer);
    URL.revokeObjectURL(pending.item.previewUrl);
    if (pending.item.serverId) void deleteServerCard(pending.item.serverId);
  }, []);
  useEffect(() => {
    const removals = pendingRemovals.current;
    return () => {
      for (const id of [...removals.keys()]) {
        const pending = removals.get(id)!;
        removals.delete(id);
        clearTimeout(pending.timer);
        URL.revokeObjectURL(pending.item.previewUrl);
        if (pending.item.serverId) void deleteServerCard(pending.item.serverId);
      }
    };
  }, []);

  const removeItem = useCallback(
    (id: string) => {
      const index = itemsRef.current.findIndex((i) => i.id === id);
      const target = itemsRef.current[index];
      if (!target) return;

      const remaining = itemsRef.current.filter((i) => i.id !== id);
      commit(remaining);
      setSelectedId((current) =>
        current === id ? (remaining[0]?.id ?? null) : current,
      );

      pendingRemovals.current.set(id, {
        item: target,
        index,
        timer: setTimeout(() => finalizeRemoval(id), 5500),
      });
      const name = target.card ? target.card.englishName || target.card.name : "card";
      toast(`Removed ${name}`, "info", {
        label: "Undo",
        onClick: () => {
          const pending = pendingRemovals.current.get(id);
          if (!pending) return;
          pendingRemovals.current.delete(id);
          clearTimeout(pending.timer);
          const next = [...itemsRef.current];
          next.splice(Math.min(pending.index, next.length), 0, pending.item);
          commit(next);
          setSelectedId(id);
        },
      });
    },
    [commit, finalizeRemoval],
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
        },
        game: item.game,
        finish: mtgFinishOf(item),
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
      lastScan={items.find((item) => item.id === cameraItemId) ?? null}
      tally={{
        count: items.filter((item) => item.card).length,
        value: items.reduce((sum, item) => sum + (item.card ? currentPrice(item) : 0), 0),
      }}
      onCapture={onCameraCapture}
      onClose={closeCamera}
      onOpen={(id) => {
        setSelectedId(id);
        closeCamera();
      }}
    />
  );

  const identified = items.filter((i) => i.card);
  const readyCount = items.filter((i) => i.status === "ready").length;
  const soldItems = items.filter((i) => i.status === "sold");
  const listedItems = items.filter((i) => i.status === "listed");
  const pendingValue = items
    .filter((i) => i.status !== "sold")
    .reduce((sum, item) => sum + currentPrice(item), 0);
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
  const applyConditionToAll = (condition: Condition) => {
    let touched = 0;
    const next = itemsRef.current.map((item) => {
      if (item.kind === "sealed" || item.grading) return item;
      if (item.status === "listed" || item.status === "sold") return item;
      if (item.condition === condition) return item;
      touched++;
      if (item.serverId) {
        void updateServerCard(item.serverId, {
          condition: describeItemCondition({ ...item, condition }),
        });
      }
      return { ...item, condition, priceOverride: null };
    });
    if (touched > 0) {
      commit(next);
      toast(`${condition} set on ${touched} card${touched === 1 ? "" : "s"}`);
    }
  };

  return (
    <>
      {quotaNote && (
        <div
          role="alert"
          className="mx-auto mt-4 flex w-full max-w-7xl items-center justify-between gap-3 rounded-2xl border border-red-400/20 bg-red-400/10 px-5 py-3 text-sm text-red-200 sm:px-6"
        >
          <span>
            <span className="font-semibold text-red-300">Out of scans.</span>{" "}
            {quotaNote} Cards still scan by OCR, which reads less of the card.{" "}
            <Link
              href="/app/account"
              className="font-medium text-white underline underline-offset-4 transition hover:text-red-100"
            >
              See your plan
            </Link>{" "}
            <Link
              href="/help#scan-limits"
              className="font-medium text-red-200/80 underline underline-offset-4 transition hover:text-red-100"
            >
              How limits work
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
        <main className="flex flex-1 flex-col items-center gap-5 px-4 pb-12 pt-5 sm:pt-8">
          {/* Empty scanner (Chris, 09-04 "aggressive makeover"): display-type
              headline, one line of copy, the three beats as a strip, then
              the stage. App-tight — no wall of intro text. */}
          <div className="text-center">
            <h1 className="font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
              Scan. Price. <span className="holo-text">List.</span>
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-zinc-400">
              Point your phone at a card. CardFlip names it, prices it and writes the eBay listing.
            </p>
            <ol className="mx-auto mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[11px] font-medium text-zinc-400">
              {["Scan", "Matched & priced", "Published on eBay"].map((step, i) => (
                <li key={step} className="flex items-center gap-1.5">
                  <span className="flex items-center gap-1.5 rounded-full border border-edge bg-surface-1 py-1 pl-1.5 pr-2.5">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-500/20 font-mono text-[10px] font-semibold text-brand-300">{i + 1}</span>
                    {step}
                  </span>
                  {i < 2 && <span aria-hidden className="text-zinc-700">→</span>}
                </li>
              ))}
            </ol>
          </div>
          <GameToggle game={game} onChange={setGame} />
          <Uploader onFiles={addUploads} onOpenCamera={openCamera} showcase={showcase} />
          {/* The add-without-a-photo search and sealed-product rows were
              removed 09-01 (Chris): eBay listings must show the actual item —
              a card with no scan photo can only draft with catalog art eBay
              won't accept, so every card starts from a real photo now. */}
        </main>
      ) : (
        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-edge bg-surface-1 px-5 py-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <div>
                <p className="text-lg font-semibold text-white">
                  {items.length} card{items.length === 1 ? "" : "s"}
                </p>
                <p className="text-xs text-zinc-500" aria-live="polite">
                  {readyCount} ready · {listedItems.length} live · {items.length - identified.length} pending
                </p>
              </div>
              <div>
                <p className="text-lg font-semibold text-white">
                  ${pendingValue.toFixed(2)}
                </p>
                <p className="text-xs text-zinc-500">In progress</p>
              </div>
              {scanUsage && scanUsage.remaining !== null && (
                <div>
                  <p
                    className={`text-lg font-semibold ${
                      scanUsage.remaining <= 0
                        ? "text-red-400"
                        : scanUsage.remaining <= 50
                          ? "text-amber-300"
                          : "text-white"
                    }`}
                  >
                    {scanUsage.remaining}
                  </p>
                  <p className="text-xs text-zinc-500">Scans left</p>
                </div>
              )}
              {soldItems.length > 0 && (
                <div className="animate-fade-up">
                  <p className="text-lg font-semibold text-emerald-400">
                    ${totalEarned.toFixed(2)}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Sold ({soldItems.length})
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <GameToggle game={game} onChange={setGame} compact />
              <Uploader
                onFiles={addUploads}
                onOpenCamera={openCamera}
                variant="compact"
              />
              <button
                onClick={() => void sendAllToEbay()}
                disabled={bulkBusy || identified.length === 0}
                title={
                  user.ebayConnected
                    ? "Send every verified card to your eBay account"
                    : "Connect your eBay account first"
                }
                className="rounded-full bg-ebay px-4 py-2 text-sm font-semibold text-white transition hover:bg-ebay-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {bulkBusy
                  ? "Sending…"
                  : user.ebayConnected
                    ? "Send all to eBay"
                    : "Connect eBay to send"}
              </button>
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
                  View my eBay drafts ↗
                </a>
              )}
            </p>
          )}

          <div className="grid flex-1 gap-4 lg:grid-cols-[320px_1fr]">
            {/* On a phone the queue sits above the editor — capped low so the
                card being edited starts on screen instead of under a
                70dvh-tall list (the queue scrolls within itself). */}
            {/* The queue pins to the viewport and scrolls inside itself on desktop, so
                picking the next card never means scrolling away from the listing
                and back (Chris, 09-03). Phones keep the short strip above the editor. */}
            <aside className="flex max-h-[32dvh] flex-col gap-1 overflow-y-auto rounded-2xl border border-edge bg-surface-1 p-2 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:self-start">
              {items.map((item) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  onSelect={() => setSelectedId(item.id)}
                  onRemove={() => removeItem(item.id)}
                />
              ))}
            </aside>

            <section className="min-h-[24rem] rounded-2xl border border-edge bg-surface-1">
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
                      patchItem(selected.id, patch);
                      // A different catalog card (candidate pick, name
                      // search, 1st Edition ↔ unlimited swap) is a different
                      // product: the ledger row follows it, so Inventory
                      // shows the right name, set, image and 1st Edition pill.
                      if (patch.card && patch.card.id !== selected.card?.id && selected.serverId) {
                        void updateServerCard(selected.serverId, {
                          cardName: patch.card.englishName || patch.card.name,
                          setName: patch.card.setName,
                          cardNumber: patch.card.number,
                          imageUrl: patch.card.imageSmall,
                          catalogCardId: patch.card.id || null,
                          rarity: patch.card.rarity ?? null,
                          firstEdition: isFirstEditionCard(patch.card),
                        });
                      }
                    }}
                    onNext={selectNext}
                    onRemove={() => removeItem(selected.id)}
                    onApplyConditionToAll={
                      items.filter(
                        (i) =>
                          i.kind !== "sealed" &&
                          !i.grading &&
                          i.status !== "listed" &&
                          i.status !== "sold",
                      ).length > 1
                        ? applyConditionToAll
                        : undefined
                    }
                  />
                )
              ) : (
                <div className="flex h-full items-center justify-center p-8 text-sm text-zinc-500">
                  Select a card to review its listing.
                </div>
              )}
            </section>
          </div>

          <p className="text-center text-xs text-zinc-600">
            {user.ebayConnected
              ? "Drafts post straight to your eBay account. Nothing goes live until you publish."
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
          confirmLabel="Save"
          onClose={() => setCategoryPrompt(null)}
          onPick={(category) => {
            setScanCategory(category);
            saveCategory(category);
            setCategoryPrompt(null);
            // Cards already saved this session (the scan beat the answer)
            // follow the pick; unsaved ones read the ref at create time.
            for (const itemId of sessionItemIdsRef.current) {
              const it = itemsRef.current.find((i) => i.id === itemId);
              if (it?.serverId) void updateServerCard(it.serverId, { category });
            }
          }}
        />
      )}
    </>
  );
}
