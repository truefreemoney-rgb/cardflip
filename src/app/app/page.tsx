"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import Uploader from "@/components/Uploader";
import QueueRow from "@/components/QueueRow";
import CardEditor from "@/components/CardEditor";
import LanguageToggle from "@/components/LanguageToggle";
import AppTabs from "@/components/AppTabs";
import { scanCard, warmUpOcr } from "@/lib/ocr";
import { searchCards } from "@/lib/cards";
import { buildListing, currentPrice, quotePrice, toCsv, withEbayPrices } from "@/lib/listing";
import { fetchCurrentUser, logout, type SessionUser } from "@/lib/client/auth";
import { createServerCard, deleteServerCard, updateServerCard } from "@/lib/client/cardsApi";
import { fetchEbayComps } from "@/lib/client/ebayApi";
import { scanCardWithVision } from "@/lib/client/visionApi";
import { CONDITIONS } from "@/lib/listing";
import type { Condition, PokemonCard, ScanItem, ScanLanguage } from "@/lib/types";

/** Vision returns a condition string; only accept one the pricing model knows. */
function asCondition(value: string | null): Condition | null {
  return value && (CONDITIONS as string[]).includes(value)
    ? (value as Condition)
    : null;
}

function createItem(file: File, language: ScanLanguage): ScanItem {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    serverId: null,
    file,
    previewUrl: URL.createObjectURL(file),
    language,
    status: "queued",
    candidates: [],
    card: null,
    condition: "Near Mint",
    strategy: "quick",
    variant: null,
    priceOverride: null,
    vision: null,
    visionStatus: "idle",
    ebay: null,
    ebayStatus: "idle",
    ebaySold: null,
    ebaySoldStatus: "unavailable",
    ebaySoldUrl: null,
    error: null,
    listedPrice: null,
    listedAt: null,
    soldPrice: null,
    soldAt: null,
  };
}

export default function AppPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkedAuth, setCheckedAuth] = useState(false);

  const [items, setItems] = useState<ScanItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [language, setLanguage] = useState<ScanLanguage>("en");

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
        });
      } else if (patch.status === "sold") {
        void updateServerCard(item.serverId, {
          status: "sold",
          soldPrice: item.soldPrice,
          soldAt: item.soldAt,
        });
      } else if (patch.status === "ready" && "listedAt" in patch) {
        void updateServerCard(item.serverId, { status: "ready", listedAt: null });
      }
    },
    [commit],
  );

  useEffect(() => {
    fetchCurrentUser().then((current) => {
      if (!current) {
        router.replace("/signup");
        return;
      }
      setUser(current);
      setCheckedAuth(true);
    });
    warmUpOcr();
  }, [router]);

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

        patchItem(next.id, { status: "scanning" });

        try {
          // Vision first, OCR as the fallback. Tesseract misreads CJK badly
          // enough that the lookup needs fuzzy matching to cope; when vision
          // is available it reads the card directly and that guesswork goes away.
          const vision = await scanCardWithVision(next.file, next.language);

          let nameCandidates: string[];
          let cardNumber: string | null;
          let language = next.language;

          if (vision.status === "done" && vision.read) {
            const read = vision.read;
            // The photo outranks the seller's language toggle — stacks get sorted wrong.
            language = read.language;
            nameCandidates = [read.name, read.englishName].filter(
              (n): n is string => Boolean(n),
            );
            cardNumber = read.cardNumber;

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
            cardNumber = scan.cardNumber;
          }

          let matches: Awaited<ReturnType<typeof searchCards>> = [];
          // One flaky request shouldn't end the scan while a later candidate
          // would have matched, so a failed lookup moves on to the next name
          // and only counts as an outage if every one of them failed.
          let lookupErrors = 0;

          for (const candidate of nameCandidates) {
            try {
              matches = await searchCards(candidate, cardNumber, language);
              if (matches.length > 0) break;
            } catch {
              lookupErrors++;
            }
          }

          if (matches.length === 0 && lookupErrors === nameCandidates.length) {
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
            const server = await createServerCard({
              cardName: card.name,
              setName: card.setName,
              cardNumber: card.number,
              imageUrl: card.imageSmall,
              condition,
              price: quote?.suggested ?? 0,
            });
            if (server) patchItem(next.id, { serverId: server.id });
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

          if (item.serverId && item.status !== "listed" && item.status !== "sold") {
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
      (i) => i.card && i.ebayStatus === "idle" && !compsInFlight.current.has(i.id),
    );
    if (pending?.card) void loadEbayComps(pending.id, pending.card);
  }, [items, loadEbayComps]);

  const handleLanguageChange = useCallback((lang: ScanLanguage) => {
    setLanguage(lang);
    warmUpOcr(lang);
  }, []);

  const addFiles = useCallback(
    (files: File[]) => {
      const created = files.map((file) => createItem(file, language));
      commit([...itemsRef.current, ...created]);
      setSelectedId((current) => current ?? created[0]?.id ?? null);
      void pump();
    },
    [commit, pump, language],
  );

  const removeItem = useCallback(
    (id: string) => {
      const target = itemsRef.current.find((i) => i.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        if (target.serverId) void deleteServerCard(target.serverId);
      }

      const remaining = itemsRef.current.filter((i) => i.id !== id);
      commit(remaining);
      setSelectedId((current) =>
        current === id ? (remaining[0]?.id ?? null) : current,
      );
    },
    [commit],
  );

  function exportCsv() {
    const rows = items
      .filter((item) => item.card && item.status !== "sold")
      .map((item) => {
        const quote = quotePrice(
          item.card!,
          item.condition,
          item.strategy,
          item.variant ?? undefined,
        );
        const price = currentPrice(item);
        return {
          card: item.card!,
          condition: item.condition,
          listing: buildListing(item.card!, price, item.condition, quote?.price.label),
        };
      });

    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cardflip-drafts-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!checkedAuth || !user) return null;

  const identified = items.filter((i) => i.card);
  const readyCount = items.filter((i) => i.status === "ready").length;
  const soldItems = items.filter((i) => i.status === "sold");
  const listedItems = items.filter((i) => i.status === "listed");
  const pendingValue = items
    .filter((i) => i.status !== "sold")
    .reduce((sum, item) => sum + currentPrice(item), 0);
  const totalEarned = soldItems.reduce((sum, item) => sum + currentPrice(item), 0);

  const selected = items.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 border-b border-white/5 bg-background/85 px-4 py-3 backdrop-blur-md sm:px-6">
        <Logo size="sm" />
        <AppTabs />
        <div className="flex items-center gap-3 sm:gap-4">
          {user.ebayConnected ? (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              eBay connected
            </span>
          ) : (
            <button
              onClick={() => router.push("/connect-ebay")}
              className="rounded-full bg-ebay px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-ebay-hover"
            >
              Connect eBay
            </button>
          )}
          {user.role === "admin" && (
            <Link
              href="/admin"
              className="rounded-full border border-edge px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-surface-2"
            >
              Admin
            </Link>
          )}
          <span className="hidden text-sm text-zinc-400 sm:inline">
            {user.name}
          </span>
          <button
            onClick={async () => {
              await logout();
              router.push("/");
            }}
            className="text-xs text-zinc-500 transition hover:text-zinc-300"
          >
            Sign out
          </button>
        </div>
      </header>

      {items.length === 0 ? (
        <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-16">
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-white">
              Turn your binder into listings
            </h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
              Scan cards one at a time or drop in a whole stack — everything
              gets priced and written up automatically.
            </p>
          </div>
          <LanguageToggle value={language} onChange={handleLanguageChange} />
          {language !== "en" && (
            <p className="max-w-sm text-center text-xs text-zinc-500">
              {language === "ja" ? "Japanese" : "Chinese"} cards identify
              correctly, but market pricing and photos aren&apos;t available
              for every card — you may need to set the price yourself.
            </p>
          )}
          <Uploader onFiles={addFiles} />
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
              <LanguageToggle value={language} onChange={handleLanguageChange} />
              <Uploader onFiles={addFiles} variant="compact" />
              <button
                onClick={exportCsv}
                disabled={identified.length === 0}
                className="rounded-full bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Export drafts (CSV)
              </button>
            </div>
          </div>

          <div className="grid flex-1 gap-4 lg:grid-cols-[320px_1fr]">
            <aside className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto rounded-2xl border border-edge bg-surface-1 p-2 lg:max-h-none">
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
                <CardEditor
                  key={selected.id}
                  item={selected}
                  onChange={(patch) => patchItem(selected.id, patch)}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-8 text-sm text-zinc-500">
                  Select a card to review its listing.
                </div>
              )}
            </section>
          </div>

          <p className="text-center text-xs text-zinc-600">
            Listings open in eBay pre-filled. One-click bulk posting arrives once
            the eBay API connection is live.
          </p>
        </main>
      )}
    </div>
  );
}
