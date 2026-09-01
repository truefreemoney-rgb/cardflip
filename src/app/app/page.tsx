"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Uploader from "@/components/Uploader";
import GameToggle from "@/components/GameToggle";
import CameraCapture from "@/components/CameraCapture";
import Spinner from "@/components/Spinner";
import QueueRow from "@/components/QueueRow";
import CardEditor from "@/components/CardEditor";
import SealedEditor from "@/components/SealedEditor";
import PageSkeleton from "@/components/PageSkeleton";
import { useSession } from "@/components/SessionProvider";
import { scanCard, warmUpOcr } from "@/lib/ocr";
import { searchCards } from "@/lib/cards";
import { isSecretRareNumber, type PrintedNumber } from "@/lib/cardNumber";
import {
  buildListing,
  buildSealedListing,
  withListingOverrides,
  currentPrice,
  describeItemCondition,
  effectiveVariant,
  mtgFinishOf,
  quotePrice,
  toEbayDraftsCsv,
  withEbayPrices,
} from "@/lib/listing";
import { parseGradeQuery } from "@/lib/grading";
import { readSavedGame, saveGame } from "@/lib/games";
import { readSavedCondition, readSavedStrategy } from "@/lib/client/scanPrefs";
import {
  createServerCard,
  deleteServerCard,
  fetchServerCards,
  updateServerCard,
} from "@/lib/client/cardsApi";
import { toast } from "@/components/Toaster";
import { apiPath } from "@/lib/client/basePath";
import { saveQueue } from "@/lib/client/queuePersistence";
import { EBAY_DRAFTS_URL, fetchEbayComps, sendEbayDraft } from "@/lib/client/ebayApi";
import { uploadCardPhoto } from "@/lib/client/cardPhotoApi";
import { scanCardWithVision } from "@/lib/client/visionApi";
import { primeScanFx } from "@/lib/client/scanFx";
import { CONDITIONS } from "@/lib/listing";
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
  };
}

export default function AppPage() {
  const router = useRouter();
  const { user } = useSession();

  const [items, setItems] = useState<ScanItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // English-only for now — the ja/zh pipeline underneath still works;
  // restoring <LanguageToggle> here re-enables it.
  const language: ScanLanguage = "en";
  // Which game the scanner reads: Pokémon or Magic. Remembered per browser;
  // every item entering the queue carries the game it was scanned under, so
  // switching mid-session doesn't relabel what's already there.
  const [game, setGameState] = useState<GameId>(readSavedGame);
  const setGame = useCallback((next: GameId) => {
    setGameState(next);
    saveGame(next);
  }, []);
  // Lives here rather than in Uploader: the first capture swaps the page from
  // the hero layout to the queue layout, and the viewfinder must survive that.
  const [cameraOpen, setCameraOpen] = useState(false);
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

  // The pump loop reads and writes the queue outside of React's render cycle,
  // so the ref is the source of truth and state is kept in step with it.
  const itemsRef = useRef<ScanItem[]>([]);
  const pumpingRef = useRef(false);
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
    },
    [commit],
  );

  useEffect(() => {
    warmUpOcr();
  }, []);

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
    if (pumpingRef.current) return;
    pumpingRef.current = true;

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

        try {
          // Vision first, OCR as the fallback. Tesseract misreads CJK badly
          // enough that the lookup needs fuzzy matching to cope; when vision
          // is available it reads the card directly and that guesswork goes away.
          const vision = await scanCardWithVision(next.file, next.language, next.game);

          let nameCandidates: string[];
          let printed: PrintedNumber | null;
          let language = next.language;
          // Frame style from the photo — the tiebreak that keeps a full-art
          // card off its promo/regular printing when the number is unread.
          let art: ArtStyle = null;

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
              const found = await searchCards(candidate, printed, language, undefined, next.game, art);
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
              matches = await searchCards("", printed, language, undefined, next.game);
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
              error: "No match found — search by name",
            });
          } else {
            const card = matches[0];
            patchItem(next.id, {
              status: matches.length === 1 ? "ready" : "review",
              candidates: matches,
              card,
              error: null,
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
            };
            // Without a server row the card can't be published or appear in
            // the collection — one retry covers the usual flaky-network blip.
            const server = (await createServerCard(input)) ?? (await createServerCard(input));
            if (server) {
              patchItem(next.id, { serverId: server.id });
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
                void uploadCardPhoto(server.id, next.file).then((uploaded) => {
                  if (uploaded.ok) patchItem(next.id, { photoAt: uploaded.photoAt });
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
      pumpingRef.current = false;
    }
  }, [patchItem]);

  /**
   * Price the card against what it's actually going for on eBay. Deliberately
   * not awaited inside the scan loop: a stack of cards should keep moving
   * through OCR while eBay answers, with each price sharpening as it lands.
   */
  const loadEbayComps = useCallback(
    async (id: string, card: PokemonCard) => {
      compsInFlight.current.add(id);
      patchItem(id, { ebayStatus: "loading" });

      try {
        const result = await fetchEbayComps(card);
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
            const quote = quotePrice(repriced, item.condition, item.strategy);
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
    [patchItem],
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
  useEffect(() => {
    if (resumedRef.current) return;
    const resumeId = new URLSearchParams(window.location.search).get("resume");
    if (!resumeId) return;
    resumedRef.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    void (async () => {
      const rows = await fetchServerCards();
      const row = rows.find((r) => r.id === resumeId);
      if (!row || row.kind === "sealed" || row.status === "sold") {
        setResuming(false);
        toast("Couldn't reopen that card here — scan it again");
        return;
      }
      const game = row.game === "mtg" ? "mtg" : "pokemon";
      const results = await searchCards(row.cardName, row.cardNumber || null, "en", undefined, game);
      const card =
        results.find((c) => row.catalogCardId && c.id === row.catalogCardId) ?? results[0] ?? null;
      if (!card) {
        setResuming(false);
        toast("Couldn't look that card up again — scan it to rebuild the listing");
        return;
      }
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
      };
      commit([...itemsRef.current, item]);
      setSelectedId(item.id);
      setResuming(false);
      if (row.status !== "listed") void loadEbayComps(item.id, card);
    })();
  }, [commit, loadEbayComps]);

  const openCamera = useCallback(() => {
    // A toast left over from the previous session would flash a stale result.
    setCameraItemId(null);
    // Inside the tap, so the scan sounds are allowed to play later.
    void primeScanFx();
    setCameraOpen(true);
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
   * eBay's bulk drafts file: one row per identified card that isn't already
   * on eBay, in Seller Hub's "Create new drafts" template. The seller uploads
   * it once (Seller Hub › Reports › Uploads) and the whole stack appears in
   * Seller Hub › Listings › Drafts — nothing goes live until they list it.
   */
  function exportCsv() {
    const rows = items
      .filter((item) => item.card && item.status !== "sold" && item.status !== "listed")
      .map((item) => {
        const quote = quotePrice(
          item.card!,
          item.condition,
          item.strategy,
          effectiveVariant(item),
        );
        const price = currentPrice(item);
        return {
          ledgerId: item.serverId,
          hasPhoto: item.photoAt != null,
          sealed: item.kind === "sealed",
          quantity: item.quantity ?? 1,
          listing: withListingOverrides(
            item.kind === "sealed"
              ? buildSealedListing(item.card!, price, item.productType)
              : buildListing(item.card!, price, item.condition, quote?.price.label, {
                  firstEdition: item.firstEdition,
                  grading: item.grading,
                }),
            item,
          ),
        };
      });
    if (rows.length === 0) return;

    const blob = new Blob([toEbayDraftsCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cardflip-ebay-drafts-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    const photoless = rows.filter((r) => !r.hasPhoto).length;
    setBulkNote(
      `${rows.length} ${rows.length === 1 ? "draft" : "drafts"} in the file. Upload it at Seller Hub › Reports › Uploads (ebay.com/sh/reports/uploads) — every card lands in Seller Hub › Listings › Drafts, nothing goes live until you list it there.${
        photoless > 0
          ? ` ${photoless} ${photoless === 1 ? "has" : "have"} no photo yet — add your own photo to those in eBay's Drafts (stock art isn't allowed).`
          : ""
      }`,
    );
  }

  /**
   * "Send all to eBay": every ready, priced item that isn't on eBay yet gets
   * pushed as a draft, one after another (eBay rate-limits, and a stack of
   * 30 cards is a stack of 30 inventory writes). Same payload the editor's
   * button sends, so a bulk push and a single push can't drift.
   */
  async function sendAllToEbay() {
    if (!user?.ebayConnected) {
      router.push("/connect-ebay");
      return;
    }
    const targets = itemsRef.current.filter(
      (item) =>
        item.card &&
        item.serverId &&
        item.status === "ready" &&
        !item.ebayOfferId &&
        !item.ebayDraftUrl &&
        currentPrice(item) > 0,
    );
    // eBay's picture policy: only items with the seller's own photo can go.
    // Search-added / sealed items without one are left for the editor's
    // "Add photo" — never sent with catalogue art.
    const noPhoto = targets.filter((item) => !item.file && !item.photoAt).length;
    const sendable = targets.filter((item) => item.file || item.photoAt);
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
    let sent = 0;
    let viaInventory = 0;
    let firstError: string | null = null;
    for (const item of sendable) {
      const price = currentPrice(item);
      const quote = quotePrice(item.card!, item.condition, item.strategy, effectiveVariant(item));
      const listing = withListingOverrides(
        item.kind === "sealed"
          ? buildSealedListing(item.card!, price, item.productType)
          : buildListing(item.card!, price, item.condition, quote?.price.label, {
              firstEdition: item.firstEdition,
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
        firstEdition: item.firstEdition,
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
        if (result.code === "not_connected" || result.code === "unconfigured") break;
      }
    }
    setBulkBusy(false);
    const skipped = noPhoto
      ? ` ${noPhoto} skipped — ${noPhoto === 1 ? "it needs" : "they need"} your own photo (open the card, Add photo).`
      : "";
    // Two roads (see sendEbayDraft): Listing API drafts live in My eBay ›
    // Drafts; Inventory drafts are saved on eBay but publish from here.
    const where = viaInventory > 0 ? "saved on eBay — open each card here to publish" : "in your eBay Drafts — finish them on eBay, or open a card here to publish now";
    setBulkNote(
      firstError
        ? `${sent} of ${sendable.length} sent to eBay. First problem: ${firstError}${skipped}`
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
      onCapture={(file) => setCameraItemId(addFiles([file])[0] ?? null)}
      onClose={() => setCameraOpen(false)}
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
        <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-zinc-400">
          <Spinner className="h-6 w-6" />
          <p className="text-sm font-medium text-white">Reopening your card…</p>
          <p className="text-xs text-zinc-500">Pulling the match, prices, and your photo back up.</p>
        </main>
      ) : items.length === 0 ? (
        <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-16">
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-white">
              Turn your binder into listings
            </h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
              Scan cards one at a time or drop in a whole stack — everything
              gets priced and written up automatically.
            </p>
            {/* First-scan guidance: what happens after the photo, in three beats. */}
            <ol className="mx-auto mt-4 flex max-w-lg flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-xs text-zinc-500">
              {["Snap or drop a photo", "We match, grade & price it", "One tap drafts it on eBay"].map((step, i) => (
                <li key={step} className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-500/15 font-mono text-[10px] font-semibold text-brand-300">{i + 1}</span>
                  <span>{step}</span>
                  {i < 2 && <span aria-hidden className="ml-1 hidden text-zinc-700 sm:inline">→</span>}
                </li>
              ))}
            </ol>
          </div>
          <GameToggle game={game} onChange={setGame} />
          <Uploader onFiles={addFiles} onOpenCamera={openCamera} />
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
                onFiles={addFiles}
                onOpenCamera={openCamera}
                variant="compact"
              />
              <button
                onClick={exportCsv}
                disabled={identified.length === 0}
                className="rounded-full bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Download eBay drafts file
              </button>
              <button
                onClick={() => void sendAllToEbay()}
                disabled={bulkBusy || identified.length === 0}
                title={
                  user.ebayConnected
                    ? "Save every ready card as a draft in your eBay account"
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
            <aside className="flex max-h-[70dvh] flex-col gap-1 overflow-y-auto rounded-2xl border border-edge bg-surface-1 p-2 lg:max-h-none">
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
                    onChange={(patch) => patchItem(selected.id, patch)}
                    onNext={selectNext}
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
    </>
  );
}
