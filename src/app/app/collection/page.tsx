"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CardImage from "@/components/CardImage";
import CardDetailModal from "@/components/CardDetailModal";
import { fetchCardById, searchCards } from "@/lib/cards";
import { normalizeNumber } from "@/lib/cardNumber";
import GameToggle from "@/components/GameToggle";
import { readSavedGame, saveGame } from "@/lib/games";
import type { GameId, PokemonCard } from "@/lib/types";
import PageSkeleton from "@/components/PageSkeleton";
import Spinner from "@/components/Spinner";
import PriceInput from "@/components/PriceInput";
import { useFocusTrap } from "@/lib/client/useFocusTrap";
import { useSession } from "@/components/SessionProvider";
import {
  deleteServerCard,
  fetchRepriceNudges,
  fetchServerCards,
  repriceCard,
  updateServerCard,
  type RepriceNudge,
  type ServerCard,
} from "@/lib/client/cardsApi";
import { endEbayListing, fetchWatcherEligible, saveAutoOffer, sendWatcherOffer, syncEbaySales } from "@/lib/client/ebayApi";
import { confirmAction } from "@/components/ConfirmDialog";
import { apiPath } from "@/lib/client/basePath";
import { estimatedEbayFees, netAfterFees, POSTAGE_USD } from "@/lib/fees";
import { toast } from "@/components/Toaster";

/**
 * Every card the seller has ever scanned, with where it is in its life:
 * draft → listed → sold. The scanner page is a per-session workbench; this is
 * the ledger that survives closing the tab.
 */

type StatusFilter = "all" | "ready" | "listed" | "ended" | "sold";

/** A listing that ended on eBay without selling (seller ended it, or eBay
 *  did) — still status "listed" on the row, but not live and not in play. */
const isEnded = (c: ServerCard) => c.status === "listed" && !!c.ebayEndedAt;
const isLive = (c: ServerCard) => c.status === "listed" && !c.ebayEndedAt;

const STATUS_LABEL: Record<ServerCard["status"], string> = {
  ready: "Draft",
  listed: "Live",
  sold: "Sold",
};

/** The listing page for a ledger row, with the hints that make reopening instant. */
function resumeHrefFor(card: ServerCard): string {
  return `/app?resume=${card.id}&rn=${encodeURIComponent(card.cardName)}&rnum=${encodeURIComponent(card.cardNumber || "")}&rg=${card.game === "mtg" ? "mtg" : "pokemon"}&ri=${encodeURIComponent(card.imageUrl || "")}${card.photoAt ? `&rp=${card.photoAt}` : ""}`;
}

/** What the ledger row already knows about its catalog card, shaped for the
 * detail modal — shown the instant a tile is tapped while the real row loads. */
function catalogStub(card: ServerCard): PokemonCard {
  return {
    id: card.catalogCardId ?? "",
    name: card.cardName,
    setName: card.setName,
    setSeries: "",
    number: card.cardNumber,
    rarity: null,
    imageSmall: card.imageUrl,
    imageLarge: card.imageUrl,
    prices: [],
    englishName: null,
    ...(card.game === "mtg" ? { game: "mtg" as const } : {}),
  };
}

/** Grid or rows — remembered per browser (Chris, 09-04: "way more visual"). */
const VIEW_KEY = "cardflip.inventoryView";
type InventoryView = "grid" | "list";

const STATUS_CHIP: Record<ServerCard["status"], string> = {
  ready: "bg-zinc-400/10 text-zinc-300",
  listed: "bg-emerald-500/20 text-emerald-300",
  sold: "bg-sky-400/10 text-sky-300",
};

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ready", label: "Drafts" },
  { value: "listed", label: "Live" },
  { value: "ended", label: "Ended" },
  { value: "sold", label: "Sold" },
];

// Sorts a seller actually reaches for: the money cards, what's been sitting
// live the longest, and what just sold. Applied client-side over the loaded
// ledger; "newest" matches the server's own order.
type SortKey = "newest" | "price" | "rarity" | "listedAge" | "soldRecent";

/**
 * Rarity rank for sorting, rarest first. Pokémon tiers as TCGplayer /
 * pokemontcg.io spell them, then Magic's four. Anything unrecognised sorts
 * after the known tiers, and rows scanned before rarity was stored go last.
 */
const RARITY_RANK: string[] = [
  "special illustration rare", "hyper rare", "secret rare", "rare secret", "rare rainbow", "rare shiny gx",
  "rare ultra", "ultra rare", "illustration rare", "shiny ultra rare", "shiny rare", "double rare", "ace spec rare",
  "amazing rare", "radiant rare", "trainer gallery rare holo", "rare holo vmax", "rare holo vstar", "rare holo v",
  "rare holo gx", "rare holo ex", "rare holo lv.x", "rare break", "rare prime", "legend", "rare holo", "rare",
  "promo", "uncommon", "common",
  // Magic
  "mythic", "special", "rare", "uncommon", "common",
];
function rarityRank(rarity: string | null): number {
  if (!rarity) return 1000;
  const key = rarity.trim().toLowerCase();
  const i = RARITY_RANK.indexOf(key);
  if (i !== -1) return i;
  // Unknown spellings: anything that says "rare" outranks the commons.
  return key.includes("rare") ? 500 : 900;
}
const SORTS: { value: SortKey; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "price", label: "Price high → low" },
  { value: "rarity", label: "Rarity" },
  { value: "listedAge", label: "Longest listed" },
  { value: "soldRecent", label: "Recently sold" },
];

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Net comes from lib/fees.ts: the Finances-API actual fee once the sync has
// recorded one (card.soldFees), the 13.25%+$0.30 estimate until then.

/**
 * The three-line ledger under a money tile: label left, signed amount right
 * on a tabular column, so "asking − fees − postage = the big number" reads
 * at a glance (Chris, 09-03: the one-line version was "kinda sloppy").
 */
function Breakdown({ rows, muted = false }: { rows: [string, number][]; muted?: boolean }) {
  return (
    <dl className={`mt-3 space-y-1 border-t border-edge/60 pt-2.5 text-xs ${muted ? "opacity-50" : ""}`}>
      {rows.map(([label, amount]) => (
        <div key={label} className="flex items-baseline justify-between gap-3">
          <dt className="truncate text-zinc-500">{label}</dt>
          <dd className={`shrink-0 tabular-nums ${amount < 0 ? "text-zinc-400" : "text-zinc-300"}`}>
            {amount < 0 ? "−" : ""}${Math.abs(amount).toFixed(2)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// Outside the component so the render-purity lint can see these only run on
// click, not during render. (No "mark listed" any more — Chris, 09-03:
// a draft is a draft until the app publishes it, then it turns Live by
// itself; publishDraft sets status = listed server-side.)
function soldNowPatch(price: number) {
  return { status: "sold" as const, soldPrice: price, soldAt: Date.now() };
}

function watcherOfferNowPatch() {
  return { watcherOfferAt: Date.now() };
}

/**
 * The reprice sheet for a live listing: the price big and typed like money
 * (PriceInput, not a spinner box), quick nudges, the net after fees, and one
 * button that updates the eBay listing. Bottom sheet on a phone, centered on
 * a desktop. (Chris, 09-04: the inline box "didn't feel right".)
 */
function RepriceSheet({
  card,
  nudge,
  busy,
  onClose,
  onSubmit,
}: {
  card: ServerCard;
  nudge: RepriceNudge | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (price: number) => void;
}) {
  const [price, setPrice] = useState(card.price);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const changed = Math.abs(price - card.price) >= 0.005;
  const net = price > 0 ? Math.max(0, netAfterFees(price) - POSTAGE_USD) : 0;
  const nudgeBy = (pct: number) => setPrice(Math.max(0.99, Math.round(card.price * (1 + pct / 100) * 100) / 100));
  const quick: { label: string; pct: number }[] = [
    { label: "−10%", pct: -10 },
    { label: "−5%", pct: -5 },
    { label: "+5%", pct: 5 },
    { label: "+10%", pct: 10 },
  ];

  return (
    <div
      className="animate-fade-up fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Change the listing price of ${card.cardName}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl border border-edge bg-surface-1 p-5 shadow-2xl shadow-black/60 outline-none sm:rounded-2xl sm:p-6"
      >
        <div className="flex items-start gap-3">
          <CardImage src={card.imageUrl} alt="" className="h-16 w-12 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-white">{card.cardName}</p>
            <p className="truncate text-xs text-zinc-500">
              {card.setName}
              {card.cardNumber ? ` · ${card.cardNumber}` : ""}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Listed on eBay at <span className="font-semibold text-zinc-200">${card.price.toFixed(2)}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-white/5 hover:text-white"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M5 5l10 10M15 5l-10 10" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <label className="mt-5 block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">New listing price</span>
          <span className="mt-1.5 flex items-center rounded-xl border border-edge bg-black/40 px-4 focus-within:border-brand-400">
            <span className="text-2xl font-semibold text-zinc-500">$</span>
            <PriceInput
              value={price}
              onValue={setPrice}
              className="w-full bg-transparent py-3 pl-2 text-right font-display text-3xl font-semibold tracking-tight text-white outline-none"
            />
          </span>
        </label>

        <div className="mt-3 flex flex-wrap gap-2">
          {quick.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => nudgeBy(q.pct)}
              className="rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-edge-strong hover:text-white"
            >
              {q.label}
            </button>
          ))}
          {nudge && (
            <button
              type="button"
              onClick={() => setPrice(nudge.market)}
              className="rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:border-amber-400/50"
              title="TCGplayer market today"
            >
              Market ${nudge.market.toFixed(2)}
            </button>
          )}
        </div>

        <p className="mt-4 text-xs text-zinc-500">
          You&apos;d net about <span className="font-semibold text-emerald-400">${net.toFixed(2)}</span> after eBay fees and postage.
        </p>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !changed || price <= 0}
            onClick={() => onSubmit(price)}
            className="flex flex-[2] items-center justify-center gap-2 rounded-full bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:cursor-default disabled:opacity-40"
          >
            {busy && <Spinner className="h-3.5 w-3.5" />}
            {busy ? "Updating eBay…" : "Update eBay listing"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CollectionPage() {
  const { user } = useSession();
  const [cards, setCards] = useState<ServerCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [view, setView] = useState<InventoryView>(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  function chooseView(next: InventoryView) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Private mode / blocked storage: the choice just doesn't persist.
    }
  }
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  // "Mark sold" asks what it actually went for (prefilled with the asking
  // price) instead of silently recording the ask — the Earned tiles are only
  // as honest as this number. Also reused to correct a sold row's price.
  const [soldForm, setSoldForm] = useState<{ id: string; value: string } | null>(null);
  // Change a LIVE listing's price from here and the eBay listing follows, so
  // a seller never has to go to eBay (Chris, 09-04). Live rows only — a draft
  // is priced in the editor, a sold row records what it went for.
  const [priceSheet, setPriceSheet] = useState<string | null>(null);
  // Tile art → the full card view (Chris, 09-04): everything the listing page
  // shows about the card — holo art, prices, history — plus this copy's
  // status and the one action it needs, which for drafts is "go verify /
  // list it on the listing page". Catalog rows are cached per ledger row.
  const [detail, setDetail] = useState<{ id: string; catalog: PokemonCard; loading: boolean } | null>(null);
  const catalogCache = useRef<Record<string, PokemonCard>>({});

  async function openDetail(card: ServerCard) {
    const cached = catalogCache.current[card.id];
    if (cached) {
      setDetail({ id: card.id, catalog: cached, loading: false });
      return;
    }
    setDetail({ id: card.id, catalog: catalogStub(card), loading: true });
    const game: GameId = card.game === "mtg" ? "mtg" : "pokemon";
    let found: PokemonCard | null = null;
    try {
      if (card.catalogCardId) found = await fetchCardById(card.catalogCardId, game);
      if (!found) {
        const results = await searchCards(card.cardName, card.cardNumber || null, "en", undefined, game);
        found =
          results.find((c) => card.catalogCardId && c.id === card.catalogCardId) ??
          results.find((c) => c.name === card.cardName && normalizeNumber(c.number) === normalizeNumber(card.cardNumber)) ??
          results[0] ??
          null;
      }
    } catch {
      found = null;
    }
    if (found) catalogCache.current[card.id] = found;
    setDetail((d) => (d?.id === card.id ? { id: card.id, catalog: found ?? d.catalog, loading: false } : d));
  }

  /** The Inventory half of the detail view: this copy's status, dates and actions. */
  function renderDetailAside(card: ServerCard) {
    const live = isLive(card);
    const ended = isEnded(card);
    const sold = card.status === "sold";
    const draft = card.status === "ready";
    const href = resumeHrefFor(card);
    const primary = "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white transition";
    const quiet = "inline-flex items-center justify-center rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-edge-strong hover:text-white";
    // The eBay price leads the facts (Chris, 09-04: it was buried in the
    // status sentence). Label follows the copy's state.
    const priceLabel = sold ? "Sold for" : live ? "eBay listing price" : ended ? "Listed at" : "Suggested price";
    const priceValue = sold && card.soldPrice != null ? card.soldPrice : card.price;
    const facts: [string, string][] = [
      [priceLabel, `${priceValue.toFixed(2)}`],
      ...(card.rarity ? ([["Rarity", card.rarity]] as [string, string][]) : []),
      ["Condition", card.condition],
      ["Copies", String(card.quantity || 1)],
      ["Scanned", formatDate(card.createdAt)],
      ...(card.listedAt ? ([["Listed", formatDate(card.listedAt)]] as [string, string][]) : []),
      ...(sold && card.soldAt ? ([["Sold", formatDate(card.soldAt)]] as [string, string][]) : []),
    ];
    return (
      <div className="mt-4 rounded-xl border border-edge bg-surface-1 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {live ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live on eBay
            </span>
          ) : ended ? (
            <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300">Auction ended</span>
          ) : sold ? (
            <span className="rounded-full bg-sky-400/10 px-3 py-1 text-xs font-semibold text-sky-300">Sold</span>
          ) : card.verifiedAt ? (
            <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-400">Active draft</span>
          ) : (
            <span className="rounded-full bg-amber-400/90 px-3 py-1 text-xs font-semibold text-black">Verify match</span>
          )}
          {(card.firstEdition || card.setName.endsWith(" (1st Edition)")) && (
            <span className="rounded-full border border-brand-400/40 bg-brand-500/10 px-2.5 py-1 text-xs font-semibold text-brand-300">1st Edition</span>
          )}
          {card.matchDoubt && (
            <span className="rounded-full border border-amber-400/30 px-2.5 py-1 text-xs text-amber-300/90">⚠ {card.matchDoubt}</span>
          )}
        </div>

        <p className="mt-3 text-sm text-zinc-300">
          {sold && card.soldPrice != null ? (
            <>
              Sold for <span className="font-semibold text-white">${card.soldPrice.toFixed(2)}</span>
              {" · "}net <span className="font-semibold text-emerald-400">${netAfterFees(card.soldPrice, card.soldFees).toFixed(2)}</span>
              <span className="text-zinc-500"> after {card.soldFees != null ? "eBay fees" : "estimated fees"}</span>
            </>
          ) : live ? (
            <>
              Listed at <span className="font-semibold text-white">${card.price.toFixed(2)}</span>
              <span className="text-zinc-500"> · awaiting sale — flips to Sold on its own when eBay reports the order</span>
            </>
          ) : ended ? (
            <>
              Ended {card.ebayEndedAt ? formatDate(card.ebayEndedAt) : ""} without a sale at{" "}
              <span className="font-semibold text-white">${card.price.toFixed(2)}</span>
            </>
          ) : (
            <>
              Suggested price <span className="font-semibold text-white">${card.price.toFixed(2)}</span>
              <span className="text-zinc-500">
                {card.verifiedAt ? " · verified, not listed yet" : " · check the match against your photo before listing"}
              </span>
            </>
          )}
        </p>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
              <dd className={`truncate text-sm ${label === priceLabel ? "font-semibold text-white" : "text-zinc-200"}`}>{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 flex flex-wrap gap-2">
          {draft && card.kind !== "sealed" && (
            <Link href={href} className={`${primary} ${card.verifiedAt ? "bg-brand-500 hover:bg-brand-400" : "bg-amber-400 !text-black hover:bg-amber-300"}`}>
              {card.verifiedAt ? "Build the listing →" : "Verify match on the listing page →"}
            </Link>
          )}
          {live && card.ebayListingUrl && (
            <a href={card.ebayListingUrl} target="_blank" rel="noopener noreferrer" className={`${primary} bg-ebay hover:bg-ebay-hover`}>
              View on eBay ↗
            </a>
          )}
          {live && card.ebayOfferId && (
            <button
              type="button"
              onClick={() => {
                setDetail(null);
                setPriceSheet(card.id);
              }}
              className={quiet}
            >
              Change price
            </button>
          )}
          {live && (
            <button
              type="button"
              onClick={() => {
                setDetail(null);
                void endListing(card);
              }}
              className={quiet}
            >
              End auction
            </button>
          )}
          {ended && (
            <button
              type="button"
              onClick={() => {
                setDetail(null);
                void relist(card);
              }}
              className={`${primary} bg-brand-500 hover:bg-brand-400`}
            >
              Relist →
            </button>
          )}
          {sold && card.ebayListingUrl && (
            <a href={card.ebayListingUrl} target="_blank" rel="noopener noreferrer" className={quiet}>
              View the sale on eBay ↗
            </a>
          )}
          {(card.status !== "listed" || ended) && (
            <button
              type="button"
              onClick={() => {
                setDetail(null);
                void remove(card);
              }}
              className="inline-flex items-center justify-center rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-500 transition hover:border-red-400/40 hover:text-red-300"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    );
  }
  const [ending, setEnding] = useState<string | null>(null);
  const router = useRouter();

  /** Relist: back to a draft FIRST (so the scanner resumes a draft, not a
   *  listed row), then straight into the editor to start the flow over. */
  async function relist(card: ServerCard) {
    await applyPatch(card, { status: "ready", listedAt: null, soldPrice: null, soldAt: null });
    router.push(
      `/app?resume=${card.id}&rn=${encodeURIComponent(card.cardName)}&rnum=${encodeURIComponent(card.cardNumber || "")}&rg=${card.game === "mtg" ? "mtg" : "pokemon"}&ri=${encodeURIComponent(card.imageUrl || "")}${card.photoAt ? `&rp=${card.photoAt}` : ""}`,
    );
  }
  const [syncError, setSyncError] = useState<string | null>(null);
  // Listed cards the market has moved away from (keyed by card id).
  const [nudges, setNudges] = useState<Record<string, RepriceNudge>>({});
  const [repricing, setRepricing] = useState<string | null>(null);
  // Mass delete: ticked row ids. Listed rows can't be ticked — they're live
  // on eBay and deleting the ledger row wouldn't end the listing.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // Offers to watchers: the panel lists eBay-eligible listings; every send is
  // one explicit click + confirm — offers email real buyers, nothing auto-fires.
  const [offerPanel, setOfferPanel] = useState(false);
  const [offerLoading, setOfferLoading] = useState(false);
  const [offerEligible, setOfferEligible] = useState<string[]>([]);
  const [offerNote, setOfferNote] = useState<string | null>(null);
  const [offerPercent, setOfferPercent] = useState(10);
  const [offerSending, setOfferSending] = useState<string | null>(null);
  const [offerMessage, setOfferMessage] = useState("");
  // Auto-offer opt-in (daily sweep on 14-day slow movers, 10/day cap).
  const [autoOfferOn, setAutoOfferOn] = useState(false);
  const [autoOfferPercent, setAutoOfferPercent] = useState(10);
  const [autoOfferSaving, setAutoOfferSaving] = useState(false);

  const userId = user?.id;
  const [saleNote, setSaleNote] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchServerCards()
      .then((list) => {
        if (!cancelled) setCards(list);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // After the ledger renders, ask eBay whether any listed card has actually
    // sold — the server matches recent orders and flips them, so "sold" stops
    // being a manual button for connected sellers.
    void syncEbaySales().then((result) => {
      if (cancelled || !result) return;
      const ended = result.ended ?? [];
      if (result.sold.length > 0 || ended.length > 0) {
        setCards((prev) =>
          prev.map(
            (card) =>
              result.sold.find((s) => s.id === card.id) ??
              ended.find((e) => e.id === card.id) ??
              card,
          ),
        );
      }
      if (result.sold.length > 0) {
        setSaleNote(
          `${result.sold.length} ${result.sold.length === 1 ? "card" : "cards"} marked sold from your eBay orders.`,
        );
      } else if (ended.length > 0) {
        setSaleNote(
          `${ended.length} ${ended.length === 1 ? "listing" : "listings"} ended on eBay without selling — relist, or delete the card.`,
        );
      } else if (result.skipped === "no_scope") {
        setSaleNote(
          "Reconnect eBay (Account settings → eBay) to let CardFlip mark sold cards automatically — your current link predates that permission.",
        );
      }
    });
    // Stale-price nudges, from our own price history — cheap enough to ask
    // on every load.
    void fetchRepriceNudges().then((list) => {
      if (!cancelled && list.length > 0) {
        setNudges(Object.fromEntries(list.map((n) => [n.cardId, n])));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function applyReprice(card: ServerCard, nudge: RepriceNudge) {
    await setAskingPrice(card, nudge.market);
  }

  /** Writes a new asking price to the ledger and, when the card has an eBay
   *  offer (draft or live), onto that offer too — in place, no relist. */
  async function setAskingPrice(card: ServerCard, price: number) {
    if (Math.abs(price - card.price) < 0.005) return;
    if (!card.ebayOfferId) {
      await applyPatch(card, { price });
      toast(`${card.cardName} is now ${price.toFixed(2)}`);
      return;
    }
    setRepricing(card.id);
    setSyncError(null);
    const result = await repriceCard(card.id, price);
    setRepricing(null);
    if (!result.ok) {
      setSyncError(`Couldn't reprice ${card.cardName} — try again.`);
      toast(`Couldn't reprice ${card.cardName} — try again`, "err", {
        label: "Help",
        onClick: () => window.open("/help#reprice", "_blank", "noopener"),
      });
      return;
    }
    patchCard(card.id, { price });
    toast(`${card.cardName} repriced to ${price.toFixed(2)}${result.ebayUpdated ? " — eBay listing updated" : ""}`);
    setNudges((prev) => {
      const next = { ...prev };
      delete next[card.id];
      return next;
    });
    if (card.ebayListingUrl && !result.ebayUpdated) {
      setSyncError(
        `${card.cardName} is ${price.toFixed(2)} here now, but eBay didn't take the change${result.ebayError ? ` (${result.ebayError})` : ""} — update the live listing on eBay.`,
      );
    }
  }

  function patchCard(id: string, patch: Partial<ServerCard>) {
    setCards((prev) =>
      prev.map((card) => (card.id === id ? { ...card, ...patch } : card)),
    );
  }

  // Optimistic status changes, rolled back if the server didn't take them —
  // otherwise the page can claim "sold" for a card the ledger still has as a
  // draft, and the seller only finds out on the next refresh.
  async function applyPatch(card: ServerCard, patch: Partial<ServerCard>) {
    const before: Partial<ServerCard> = {};
    for (const key of Object.keys(patch) as (keyof ServerCard)[]) {
      (before as Record<string, unknown>)[key] = card[key];
    }
    setSyncError(null);
    patchCard(card.id, patch);
    const ok = await updateServerCard(card.id, patch);
    if (!ok) {
      patchCard(card.id, before);
      setSyncError(`Couldn't save the change to ${card.cardName} — check your connection and try again.`);
      // The banner lives at the top of a long page — repeat it where the eye is.
      toast(`Couldn't save the change to ${card.cardName}`, "err");
    }
  }

  function confirmSold(card: ServerCard, value: string) {
    const price = Math.max(0, parseFloat(value) || 0);
    if (card.status === "sold") {
      void applyPatch(card, { soldPrice: price });
    } else {
      void applyPatch(card, soldNowPatch(price));
    }
    setSoldForm(null);
    toast(`${card.cardName} sold — $${price.toFixed(2)}`);
  }

  async function openOfferPanel() {
    setOfferPanel(true);
    setOfferLoading(true);
    setOfferNote(null);
    const res = await fetchWatcherEligible();
    setOfferLoading(false);
    if (!res) {
      setOfferEligible([]);
      setOfferNote("Couldn't reach the server — close and try again.");
      return;
    }
    setOfferEligible(res.eligibleCardIds);
    if (typeof res.autoOfferPercent === "number") {
      setAutoOfferOn(true);
      setAutoOfferPercent(res.autoOfferPercent);
      if (res.autoOfferMessage) setOfferMessage(res.autoOfferMessage);
    } else {
      setAutoOfferOn(false);
    }
    if (res.skipped === "no_scope" || res.skipped === "not_connected") {
      setOfferNote("eBay declined — reconnect your eBay account (eBay setup) and try again.");
    } else if (res.skipped === "error") {
      setOfferNote("eBay didn't answer — try again in a minute.");
    } else if (res.eligibleCardIds.length === 0) {
      setOfferNote(
        "None of your live listings can take an offer right now. eBay marks a listing eligible once buyers are watching it — check back after some watchers show up.",
      );
    }
  }

  async function sendOffer(card: ServerCard) {
    const pct = Math.min(50, Math.max(5, Math.round(offerPercent) || 10));
    const discounted = card.price * (1 - pct / 100);
    if (
      !(await confirmAction({
        message: `Send ${pct}% off ${card.cardName} ($${card.price.toFixed(2)} → $${discounted.toFixed(2)}) to everyone watching it? This emails real buyers and can't be recalled.`,
        confirmLabel: "Send offer",
        danger: false,
      }))
    )
      return;
    setOfferSending(card.id);
    const result = await sendWatcherOffer(card.id, pct, offerMessage);
    setOfferSending(null);
    if (result.ok) {
      patchCard(card.id, watcherOfferNowPatch());
      toast(`Offer sent — ${pct}% off ${card.cardName} to its watchers`);
    } else {
      toast(result.message, "err");
    }
  }

  async function saveAutoOfferSetting(on: boolean, percent: number) {
    const pct = Math.min(50, Math.max(5, Math.round(percent) || 10));
    if (on && !autoOfferOn) {
      const ok = await confirmAction({
        message: `Turn on auto-offers? Once a day, CardFlip will send ${pct}% off to watchers of listings that have sat for 14+ days (max 10 offers a day, each listing offered once). Every send emails real buyers.`,
        confirmLabel: "Turn on",
        danger: false,
      });
      if (!ok) return;
    }
    setAutoOfferSaving(true);
    const result = await saveAutoOffer(on ? pct : null, on && offerMessage.trim() ? offerMessage.trim() : null);
    setAutoOfferSaving(false);
    if (result.ok) {
      setAutoOfferOn(on);
      if (on) setAutoOfferPercent(pct);
      toast(on ? `Auto-offers on — ${pct}% off slow movers` : "Auto-offers off");
    } else {
      toast(result.message, "err");
    }
  }

  /**
   * "Auction ended" (Chris, 09-03): ends the live eBay listing, then the row
   * reads Auction ended with Relist / Delete. Nothing flips locally until
   * eBay has actually ended it.
   */
  async function endListing(card: ServerCard) {
    if (
      !(await confirmAction({
        message: `End the eBay listing for ${card.cardName}? Buyers won't see it any more. You can relist it from here.`,
        confirmLabel: "End listing",
      }))
    )
      return;
    setEnding(card.id);
    const res = await endEbayListing(card.id);
    setEnding(null);
    if (!res.ok) {
      toast(`Couldn't end ${card.cardName} — ${res.message}`, "err");
      return;
    }
    setCards((prev) => prev.map((c) => (c.id === card.id ? res.card : c)));
    toast(`${card.cardName} — auction ended`);
  }

  async function remove(card: ServerCard) {
    // Deleting is the one action here with no undo — say so once.
    const label = card.status === "sold" ? "this sold record" : "this card";
    if (!(await confirmAction({ message: `Remove ${label} (${card.cardName}) from your collection? This can't be undone.`, confirmLabel: "Remove" }))) return;
    const index = cards.findIndex((c) => c.id === card.id);
    setSyncError(null);
    setCards((prev) => prev.filter((c) => c.id !== card.id));
    const ok = await deleteServerCard(card.id);
    if (!ok) {
      setCards((prev) => {
        const next = prev.filter((c) => c.id !== card.id);
        next.splice(Math.min(index, next.length), 0, card);
        return next;
      });
      setSyncError(`Couldn't remove ${card.cardName} — check your connection and try again.`);
      toast(`Couldn't remove ${card.cardName}`, "err");
      return;
    }
    toast(`${card.cardName} removed`);
  }

  // Pokémon and Magic are separate sections (Chris, 09-03: "when I upload
  // these magic cards, it should be separate from the pokemon cards").
  // Same remembered game as the scanner; stats, filters and bulk actions
  // all see only the selected game's cards.
  const [gameView, setGameView] = useState<GameId>(readSavedGame);
  const gameCards = useMemo(
    () => cards.filter((c) => (c.game ?? "pokemon") === gameView),
    [cards, gameView],
  );
  const gameCounts = useMemo(
    () => ({
      pokemon: cards.filter((c) => (c.game ?? "pokemon") === "pokemon").length,
      mtg: cards.filter((c) => c.game === "mtg").length,
    }),
    [cards],
  );
  function switchGame(next: GameId) {
    setGameView(next);
    setSelected(new Set());
    saveGame(next);
  }

  const stats = useMemo(() => {
    const drafts = gameCards.filter((c) => c.status === "ready");
    // "1 live" while nothing was live (Chris, 09-03): an ended auction is
    // neither live nor in play — it waits for Relist or Delete.
    const listed = gameCards.filter(isLive);
    const ended = gameCards.filter(isEnded);
    const sold = gameCards.filter((c) => c.status === "sold");

    const earned = sold.reduce((sum, c) => sum + (c.soldPrice ?? 0), 0);
    // Net = after eBay fees AND the postage the seller pays per sale (Chris,
    // 09-03: the tiles "should also reflect after ebay fees and shipping").
    const net = sold.reduce(
      (sum, c) => sum + (c.soldPrice != null ? netAfterFees(c.soldPrice, c.soldFees) - POSTAGE_USD : 0),
      0,
    );
    // Every sale has its real fee recorded → the fee figure drops its "≈".
    const feesExact = sold.every((c) => c.soldPrice == null || c.soldFees != null);
    const inPlayGross = [...drafts, ...listed].reduce((sum, c) => sum + c.price * (c.quantity || 1), 0);
    // What those listings would actually put in the seller's pocket: each
    // copy after the fee estimate and postage.
    const inPlay = [...drafts, ...listed].reduce(
      (sum, c) => sum + (c.price > 0 ? Math.max(0, netAfterFees(c.price) - POSTAGE_USD) : 0) * (c.quantity || 1),
      0,
    );

    // Listed→sold gap, only over cards that carry both timestamps.
    const gaps = sold
      .filter((c) => c.listedAt && c.soldAt)
      .map((c) => (c.soldAt! - c.listedAt!) / DAY_MS);
    const avgDays =
      gaps.length > 0
        ? gaps.reduce((sum, days) => sum + days, 0) / gaps.length
        : null;

    const inPlayCopies = [...drafts, ...listed].reduce((sum, c) => sum + (c.price > 0 ? c.quantity || 1 : 0), 0);
    const soldCopies = sold.filter((c) => c.soldPrice != null).length;
    return { drafts, listed, ended, sold, earned, net, feesExact, inPlay, inPlayGross, inPlayCopies, soldCopies, avgDays };
  }, [gameCards]);


  async function removeSelected() {
    const ids = [...selected].filter((id) => {
      const card = cards.find((c) => c.id === id);
      return card && card.status !== "listed";
    });
    if (ids.length === 0) return;
    if (!(await confirmAction({ message: `Remove ${ids.length} card${ids.length === 1 ? "" : "s"} from your collection? This can't be undone.`, confirmLabel: `Delete ${ids.length}` }))) return;
    setBulkDeleting(true);
    setSyncError(null);
    const removed = cards.filter((c) => ids.includes(c.id));
    setCards((prev) => prev.filter((c) => !ids.includes(c.id)));
    const results = await Promise.all(ids.map((id) => deleteServerCard(id)));
    const failed = removed.filter((_, i) => !results[i]);
    if (failed.length > 0) {
      setCards((prev) => [...failed, ...prev]);
      setSyncError(`${failed.length} of ${ids.length} couldn't be removed — check your connection and try again.`);
      toast(`${failed.length} of ${ids.length} couldn't be removed`, "err");
    } else {
      toast(`${ids.length} card${ids.length === 1 ? "" : "s"} removed`);
    }
    setSelected(new Set());
    setBulkDeleting(false);
  }

  // The whole ledger as a spreadsheet — the seller's data is theirs to take.
  // Distinct from the eBay drafts CSV (that one is eBay's upload format).
  function exportCsv() {
    const esc = (v: string | number | null | undefined) => {
      const text = v == null ? "" : String(v);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const header = [
      "Name", "Set", "Number", "Game", "Type", "Condition", "Status", "Price",
      "Copies", "Scanned", "Listed", "Sold", "Sold price", "eBay fees", "Net", "eBay listing",
    ];
    const day = (ts: number | null) => (ts ? new Date(ts).toISOString().slice(0, 10) : "");
    const lines = cards.map((c) =>
      [
        c.cardName, c.setName, c.cardNumber, c.game ?? "pokemon",
        c.kind === "sealed" ? (c.productType ?? "sealed") : "card",
        c.condition, c.status, c.price.toFixed(2), c.quantity || 1,
        day(c.createdAt), day(c.listedAt), day(c.soldAt),
        c.soldPrice != null ? c.soldPrice.toFixed(2) : "",
        // Actual Finances-API fee when synced, marked estimate otherwise.
        c.soldPrice != null
          ? c.soldFees != null
            ? c.soldFees.toFixed(2)
            : `est ${estimatedEbayFees(c.soldPrice).toFixed(2)}`
          : "",
        c.soldPrice != null ? netAfterFees(c.soldPrice, c.soldFees).toFixed(2) : "",
        c.ebayListingUrl ?? "",
      ].map(esc).join(","),
    );
    const blob = new Blob(["﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n"], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cardflip-collection-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast(`${cards.length} card${cards.length === 1 ? "" : "s"} exported to CSV`);
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const shown = gameCards.filter((card) => {
      if (filter === "listed" && !isLive(card)) return false;
      if (filter === "ended" && !isEnded(card)) return false;
      if ((filter === "ready" || filter === "sold") && card.status !== filter) return false;
      if (!needle) return true;
      return (
        card.cardName.toLowerCase().includes(needle) ||
        card.setName.toLowerCase().includes(needle)
      );
    });
    if (sort === "newest") return shown; // the server's own order
    return [...shown].sort((a, b) => {
      if (sort === "price") {
        return (b.soldPrice ?? b.price) - (a.soldPrice ?? a.price);
      }
      if (sort === "rarity") {
        const byRarity = rarityRank(a.rarity) - rarityRank(b.rarity);
        return byRarity !== 0 ? byRarity : (b.soldPrice ?? b.price) - (a.soldPrice ?? a.price);
      }
      if (sort === "listedAge") {
        // Live listings first, oldest listing at the top — "what's been
        // sitting". Unlisted rows keep their recency order after them.
        const aListed = a.status === "listed" && a.listedAt;
        const bListed = b.status === "listed" && b.listedAt;
        if (aListed && bListed) return a.listedAt! - b.listedAt!;
        if (aListed !== bListed) return aListed ? -1 : 1;
        return b.createdAt - a.createdAt;
      }
      // soldRecent: sold rows first, newest sale at the top.
      const aSold = a.status === "sold" && a.soldAt;
      const bSold = b.status === "sold" && b.soldAt;
      if (aSold && bSold) return b.soldAt! - a.soldAt!;
      if (aSold !== bSold) return aSold ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
  }, [gameCards, filter, query, sort]);

  // Shift+click fills the run between the last box clicked and this one
  // (Chris, 09-03), the way a mail client does. The anchor is the last box
  // clicked without shift; the range follows the visible (sorted, filtered)
  // order, and takes the state the anchor's click left it in.
  const [anchorId, setAnchorId] = useState<string | null>(null);
  function toggleSelected(id: string, shift = false) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && anchorId && anchorId !== id) {
        const order = visible.map((c) => c.id);
        const a = order.indexOf(anchorId);
        const b = order.indexOf(id);
        if (a >= 0 && b >= 0) {
          const on = prev.has(anchorId);
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
            if (on) next.add(order[i]);
            else next.delete(order[i]);
          }
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!shift) setAnchorId(id);
  }

  if (!user) return <PageSkeleton />;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-white">Inventory</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Everything you&apos;ve scanned, and where each card is on its way
            to sold.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <GameToggle game={gameView} onChange={switchGame} compact />
          <p className="text-[11px] text-zinc-600">
            {gameCounts.pokemon} Pokémon · {gameCounts.mtg} Magic
          </p>
        </div>
      </div>

      {syncError && (
        <p
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300"
        >
          {syncError}
        </p>
      )}

      {saleNote && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">
          {saleNote}
        </p>
      )}

      {/* One panel, two money columns of equal weight (the ledgers keep
          them the same height), and the counts as a quiet strip beneath —
          instead of four equal tiles where three sat empty around a lone
          number (Chris, 09-03: "this whole design isn't sitting well"). */}
      <section className="overflow-hidden rounded-2xl border border-edge bg-surface-1">
        <div className="grid sm:grid-cols-2 sm:divide-x sm:divide-edge/60">
          <div className="p-5">
            <p className="text-xs uppercase tracking-[0.15em] text-zinc-500">In play</p>
            <p className="mt-1.5 font-display text-3xl font-semibold tracking-tight text-white">
              ${stats.inPlay.toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Take-home if every draft and live listing sells</p>
            <Breakdown
              rows={[
                ["Asking", stats.inPlayGross],
                ["eBay fees (est.)", -(stats.inPlayGross - stats.inPlay - stats.inPlayCopies * POSTAGE_USD)],
                [`Postage · ${stats.inPlayCopies} × $${POSTAGE_USD.toFixed(2)}`, -(stats.inPlayCopies * POSTAGE_USD)],
              ]}
            />
          </div>
          <div className="border-t border-edge/60 p-5 sm:border-t-0">
            {/* The big number is the money that actually reached the seller —
                net after eBay fees and postage, same as the admin panel leads
                with (Chris, 08-31: sellers need to see the sale the way admin
                does). */}
            <p className="text-xs uppercase tracking-[0.15em] text-zinc-500">Earned</p>
            <p className="mt-1.5 font-display text-3xl font-semibold tracking-tight text-emerald-400">
              ${stats.net.toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {stats.sold.length === 0
                ? "Nothing sold yet — it starts counting at the first sale"
                : `Take-home from ${stats.sold.length} sale${stats.sold.length === 1 ? "" : "s"}${
                    stats.avgDays !== null ? ` · ~${Math.max(1, Math.round(stats.avgDays))} days to sell` : ""
                  }`}
            </p>
            {stats.sold.length > 0 ? (
              <Breakdown
                rows={[
                  ["Sold for", stats.earned],
                  [`eBay fees${stats.feesExact ? "" : " (est.)"}`, -(stats.earned - stats.net - stats.soldCopies * POSTAGE_USD)],
                  [`Postage · ${stats.soldCopies} × $${POSTAGE_USD.toFixed(2)}`, -(stats.soldCopies * POSTAGE_USD)],
                ]}
              />
            ) : (
              <Breakdown
                rows={[
                  ["Sold for", 0],
                  ["eBay fees", 0],
                  ["Postage", 0],
                ]}
                muted
              />
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-edge/60 px-5 py-3 text-sm">
          <span className="text-zinc-400">
            <span className="font-display text-base font-semibold text-white">{stats.drafts.length}</span> drafts
          </span>
          <span className="text-zinc-400">
            <span className="font-display text-base font-semibold text-sky-300">{stats.listed.length}</span> live
          </span>
          {stats.ended.length > 0 && (
            <span className="text-zinc-400">
              <span className="font-display text-base font-semibold text-amber-300">{stats.ended.length}</span> ended
            </span>
          )}
          <span className="text-zinc-400">
            <span className="font-display text-base font-semibold text-emerald-300">{stats.sold.length}</span> sold
          </span>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-full border border-edge bg-surface-1 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                filter === f.value
                  ? "bg-brand-500 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {/* Wraps on a phone: without it the filter box was squeezed to two
            letters between the sort select and Export CSV (Chris, 09-02). */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Slide tab (Chris, 09-04: "Switch View — Image or Text"): the
              thumb slides under the chosen side so the state reads at a glance. */}
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">View</span>
            <div
              role="tablist"
              aria-label="Switch view"
              className="relative grid h-9 w-[152px] grid-cols-2 rounded-full border border-edge bg-surface-1 p-1"
            >
              <span
                aria-hidden
                className={`absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-brand-500 shadow-md shadow-brand-500/30 transition-transform duration-200 ease-out ${
                  view === "list" ? "translate-x-full" : ""
                }`}
              />
              {(["grid", "list"] as InventoryView[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => chooseView(v)}
                  className={`relative z-10 flex items-center justify-center gap-1.5 rounded-full text-xs font-semibold transition-colors ${
                    view === v ? "text-white" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {v === "grid" ? (
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                      <rect x="3" y="3" width="6" height="6" rx="1.2" />
                      <rect x="11" y="3" width="6" height="6" rx="1.2" />
                      <rect x="3" y="11" width="6" height="6" rx="1.2" />
                      <rect x="11" y="11" width="6" height="6" rx="1.2" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                      <path d="M4 5.5h12M4 10h12M4 14.5h12" />
                    </svg>
                  )}
                  {v === "grid" ? "Image" : "Text"}
                </button>
              ))}
            </div>
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort cards"
            className="shrink-0 rounded-full border border-edge bg-surface-1 px-3 py-2 text-sm text-zinc-300 focus:border-brand-400 focus:outline-none"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <input
            type="search"
            aria-label="Filter cards by name or set"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or set"
            className="min-w-[10rem] flex-1 rounded-full border border-edge bg-surface-1 px-4 py-2 text-base text-white placeholder:text-zinc-600 focus:border-brand-400 focus:outline-none sm:max-w-xs sm:text-sm"
          />
          <button
            onClick={exportCsv}
            disabled={cards.length === 0}
            className="shrink-0 rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-edge-strong hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Export CSV
          </button>
          {cards.some((c) => c.status === "listed" && c.ebayListingId) && (
            <button
              onClick={() => (offerPanel ? setOfferPanel(false) : void openOfferPanel())}
              className="shrink-0 rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-edge-strong hover:text-white"
            >
              Offer to watchers
            </button>
          )}
        </div>
      </div>

      {offerPanel && (
        <section className="rounded-2xl border border-edge bg-surface-1 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">Offer to watchers</h2>
              <p className="mt-1 text-sm text-zinc-500">
                eBay emails a private discount to everyone watching a listing. One offer per
                buyer per listing — pick the card, pick the cut, send.{" "}
                <a
                  href="/help#offers"
                  target="_blank"
                  rel="noopener"
                  className="text-zinc-400 underline underline-offset-2 transition hover:text-zinc-200"
                >
                  How offers work
                </a>
              </p>
            </div>
            <button
              onClick={() => setOfferPanel(false)}
              aria-label="Close offers panel"
              className="text-zinc-500 transition hover:text-zinc-300"
            >
              ✕
            </button>
          </div>
          {offerLoading ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
              <Spinner className="h-4 w-4" /> Asking eBay which listings can take an offer…
            </p>
          ) : (
            <>
              {offerNote && <p className="mt-4 text-sm text-zinc-400">{offerNote}</p>}
              {offerEligible.length > 0 && (
                <>
                  <label className="mt-4 flex items-center gap-2 text-sm text-zinc-400">
                    Discount
                    <input
                      type="number"
                      min={5}
                      max={50}
                      value={offerPercent}
                      onChange={(e) => setOfferPercent(Number(e.target.value))}
                      className="w-16 rounded-lg border border-edge bg-black/40 px-2 py-1.5 text-center text-sm text-white outline-none focus:border-brand-400"
                      aria-label="Discount percent"
                    />
                    % off the listed price
                  </label>
                  <ul className="mt-3 divide-y divide-white/5">
                    {cards
                      .filter((c) => offerEligible.includes(c.id))
                      .map((card) => {
                        const pct = Math.min(50, Math.max(5, Math.round(offerPercent) || 10));
                        return (
                          <li key={card.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-white">{card.cardName}</p>
                              <p className="text-xs text-zinc-500">
                                {card.setName} · ${card.price.toFixed(2)} →{" "}
                                <span className="text-emerald-400">
                                  ${(card.price * (1 - pct / 100)).toFixed(2)}
                                </span>
                              </p>
                            </div>
                            {card.watcherOfferAt ? (
                              <span className="text-xs text-zinc-500">
                                Offer sent {new Date(card.watcherOfferAt).toLocaleDateString()}
                              </span>
                            ) : (
                              <button
                                onClick={() => void sendOffer(card)}
                                disabled={offerSending !== null}
                                className="rounded-full bg-brand-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-400 disabled:opacity-50"
                              >
                                {offerSending === card.id ? "Sending…" : "Send offer"}
                              </button>
                            )}
                          </li>
                        );
                      })}
                  </ul>
                </>
              )}

              <label className="mt-4 block text-sm text-zinc-400">
                Message to buyers <span className="text-zinc-600">(optional, goes in eBay&apos;s offer email — manual and auto sends alike)</span>
                <input
                  type="text"
                  maxLength={2000}
                  value={offerMessage}
                  onChange={(e) => setOfferMessage(e.target.value)}
                  onBlur={() => { if (autoOfferOn) void saveAutoOfferSetting(true, autoOfferPercent); }}
                  placeholder="Thanks for watching — happy to make a deal."
                  className="mt-1.5 w-full rounded-lg border border-edge bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-brand-400"
                />
              </label>

              {/* Auto-offers: strictly opt-in — the daily job sends the
                  configured discount to watchers of 14-day slow movers,
                  10/day, each listing once. Lives here (not account) so
                  the setting sits next to the manual sends it automates. */}
              <div className="mt-5 rounded-xl border border-edge bg-black/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2.5 text-sm font-medium text-white">
                    <input
                      type="checkbox"
                      checked={autoOfferOn}
                      disabled={autoOfferSaving}
                      onChange={(e) => void saveAutoOfferSetting(e.target.checked, autoOfferPercent)}
                      className="h-4 w-4 accent-brand-500"
                    />
                    Auto-offer on slow movers
                  </label>
                  {autoOfferOn && (
                    <label className="flex items-center gap-2 text-sm text-zinc-400">
                      <input
                        type="number"
                        min={5}
                        max={50}
                        value={autoOfferPercent}
                        disabled={autoOfferSaving}
                        onChange={(e) => setAutoOfferPercent(Number(e.target.value))}
                        onBlur={() => void saveAutoOfferSetting(true, autoOfferPercent)}
                        className="w-16 rounded-lg border border-edge bg-black/40 px-2 py-1.5 text-center text-sm text-white outline-none focus:border-brand-400"
                        aria-label="Auto-offer discount percent"
                      />
                      % off
                    </label>
                  )}
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  Once a day, watchers of listings that have sat 14+ days get this discount
                  automatically (up to 10 offers a day, each listing offered once). The message
                  above rides along. Off by default.
                </p>
              </div>
            </>
          )}
        </section>
      )}

      {/* Selection toolbar. Every row can be ticked now (listed included) —
          each bulk action applies itself only to the rows it makes sense on,
          and Delete still refuses live listings (unlist first). Shipped a
          stack? Listed a pile by hand? One pass instead of row-by-row
          (Chris, 09-01 QoL pass). */}
      {visible.length > 0 && (
        <div className="-mt-2 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2 text-zinc-400">
            <input
              type="checkbox"
              checked={visible.length > 0 && visible.every((c) => selected.has(c.id))}
              onChange={(e) => {
                setSelected(e.target.checked ? new Set(visible.map((c) => c.id)) : new Set());
              }}
              className="h-4 w-4 accent-brand-500"
              aria-label="Select all shown cards"
            />
            Select all
          </label>
          {selected.size > 0 && (() => {
            const selCards = cards.filter((c) => selected.has(c.id));
            const ready = selCards.filter((c) => c.status === "ready");
            const listed = selCards.filter(isLive);
            const revertable = selCards.filter((c) => c.status !== "ready");
            const deletable = selCards.filter((c) => !isLive(c));
            const bulkBtn =
              "rounded-full border border-edge px-3.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-edge-strong hover:bg-surface-2 disabled:opacity-50";
            async function applyToAll(targets: ServerCard[], patch: (c: ServerCard) => Partial<ServerCard>, note: string) {
              await Promise.all(targets.map((c) => applyPatch(c, patch(c))));
              setSelected(new Set());
              toast(note);
            }
            return (
              <>
                <span className="text-zinc-500">{selected.size} selected</span>
                {/* The whole selection into the scanner's queue, so each can
                    be verified against its photo without a round trip per
                    card (Chris, 09-03). Sealed rows have no listing screen. */}
                {ready.filter((c) => c.kind !== "sealed").length > 0 && (
                  <Link
                    href={`/app?resume=${ready
                      .filter((c) => c.kind !== "sealed")
                      .map((c) => c.id)
                      .join(",")}`}
                    className="rounded-full bg-brand-500/15 px-3.5 py-1.5 text-xs font-semibold text-brand-300 transition hover:bg-brand-500/25"
                  >
                    Move to listings ({ready.filter((c) => c.kind !== "sealed").length})
                  </Link>
                )}
                {listed.length > 0 && (
                  <button
                    onClick={() =>
                      void applyToAll(
                        listed,
                        (c) => soldNowPatch(c.price),
                        `${listed.length} marked sold at asking price`,
                      )
                    }
                    title="Records each sale at its asking price — click a sold row's price to correct one"
                    className={bulkBtn}
                  >
                    Mark sold ({listed.length})
                  </button>
                )}
                {revertable.length > 0 && (
                  <button
                    onClick={() =>
                      void applyToAll(
                        revertable,
                        () => ({ status: "ready" as const, listedAt: null, soldPrice: null, soldAt: null }),
                        `${revertable.length} back to drafts`,
                      )
                    }
                    className={bulkBtn}
                  >
                    Back to drafts ({revertable.length})
                  </button>
                )}
                <button
                  onClick={() => void removeSelected()}
                  disabled={bulkDeleting || deletable.length === 0}
                  title={deletable.length === 0 ? "Live listings can't be deleted — unlist them first" : undefined}
                  className="rounded-full border border-red-400/40 px-3.5 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
                >
                  {bulkDeleting ? "Removing…" : `Delete ${deletable.length} card${deletable.length === 1 ? "" : "s"}`}
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  className="text-xs text-zinc-500 underline underline-offset-4 hover:text-zinc-300"
                >
                  Clear
                </button>
              </>
            );
          })()}
        </div>
      )}

      {loading ? (
        <div className="overflow-hidden rounded-2xl border border-edge bg-surface-1">
          <ul className="animate-pulse divide-y divide-white/5">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="h-14 w-10 rounded bg-white/5" />
                <div className="flex flex-col gap-2">
                  <div className="h-3 w-40 rounded bg-white/5" />
                  <div className="h-3 w-24 rounded bg-white/5" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-edge-strong bg-surface-1 py-16 text-center">
          <div className="text-3xl">🃏</div>
          <p className="text-sm font-medium text-white">
            {cards.length === 0 ? "No cards yet" : "Nothing matches"}
          </p>
          <p className="max-w-xs text-xs text-zinc-500">
            {cards.length === 0
              ? "Scan a card and it will show up here, tracked from draft to sold."
              : "Try a different filter or search."}
          </p>
          {cards.length === 0 && (
            <Link
              href="/app"
              className="mt-2 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400"
            >
              Scan your first card
            </Link>
          )}
        </div>
      ) : view === "grid" ? (
        /* Binder view (Chris, 09-04): the card IS the row. Your own photo when
           one is stored, status as a pill on the art, the price where a price
           sticker goes, a Sold stamp across sold copies. The art is the
           primary action — a draft opens in the editor, a live listing opens
           the reprice sheet. Select and Delete reveal on hover / show on
           touch, like the watchlist tiles. */
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {visible.map((card) => {
            const live = isLive(card);
            const ended = isEnded(card);
            const sold = card.status === "sold";
            const draft = card.status === "ready";
            const isSelected = selected.has(card.id);
            const img = card.photoAt ? apiPath(`/api/card-image/${card.id}?v=${card.photoAt}`) : card.imageUrl;
            const resumeHref = `/app?resume=${card.id}&rn=${encodeURIComponent(card.cardName)}&rnum=${encodeURIComponent(card.cardNumber || "")}&rg=${card.game === "mtg" ? "mtg" : "pokemon"}&ri=${encodeURIComponent(card.imageUrl || "")}${card.photoAt ? `&rp=${card.photoAt}` : ""}`;
            const glow = live
              ? "ring-emerald-400/40 shadow-emerald-500/15"
              : ended
                ? "ring-amber-400/40 shadow-amber-500/10"
                : sold
                  ? "ring-sky-400/30 shadow-sky-500/10"
                  : draft && !card.verifiedAt
                    ? "ring-amber-300/25 shadow-black/40"
                    : "ring-white/10 shadow-black/40";
            const art = (
              <>
                <CardImage
                  src={img}
                  alt={card.cardName}
                  className={`h-full w-full ${sold ? "opacity-70 saturate-50" : ""}`}
                />
                {sold && (
                  <span
                    aria-hidden
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded-md border-2 border-sky-300/80 px-3 py-1 font-display text-lg font-bold uppercase tracking-[0.3em] text-sky-200/90 shadow-lg"
                  >
                    Sold
                  </span>
                )}
                {/* Price sticker — the one number a seller scans a binder for. */}
                <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2.5 pb-2 pt-8">
                  <span className="min-w-0 pr-2 text-left">
                    <span className="block truncate text-xs font-semibold text-white">{card.cardName}</span>
                    <span className="block truncate text-[10px] text-zinc-400">{card.setName}</span>
                  </span>
                  <span className={`shrink-0 font-display text-base font-bold tracking-tight ${sold ? "text-emerald-400" : "text-white"}`}>
                    {sold && card.soldPrice != null
                      ? `${netAfterFees(card.soldPrice, card.soldFees).toFixed(2)}`
                      : `${card.price.toFixed(2)}`}
                  </span>
                </span>
              </>
            );
            return (
              <li
                key={card.id}
                className={`group relative flex flex-col overflow-hidden rounded-2xl border border-edge bg-surface-1 shadow-lg ring-1 transition hover:-translate-y-1 hover:shadow-xl ${glow} ${
                  isSelected ? "outline outline-2 outline-brand-400" : ""
                }`}
              >
                {/* The art opens the full card view — prices, history, this
                    copy's status and actions (Chris, 09-04). */}
                <button
                  type="button"
                  onClick={() => void openDetail(card)}
                  title={`Open ${card.cardName}`}
                  className="relative block aspect-[5/7] w-full bg-black/40 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
                >
                  {art}
                  {/* Always-visible affordance (Chris, 09-04: nothing said the
                      art was tappable). Bottom-right so it clears the status
                      pills; brightens on hover, and the button is the hit area. */}
                  <span className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-zinc-100 shadow backdrop-blur transition group-hover:bg-brand-500/90 group-hover:text-white">
                    {live ? "View listing" : draft ? "View draft" : "View card"}
                    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h7v7M13 3 7 9" /></svg>
                  </span>
                </button>

                {/* Status, top-left, on the art. */}
                <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1">
                  {live ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 backdrop-blur">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      </span>
                      Live
                    </span>
                  ) : ended ? (
                    <span className="rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-amber-300 backdrop-blur">Auction ended</span>
                  ) : draft && !card.verifiedAt ? (
                    <span className="rounded-full bg-amber-400/90 px-2 py-0.5 text-[10px] font-semibold text-black shadow">Verify match</span>
                  ) : draft ? (
                    <span className="rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 backdrop-blur">Active</span>
                  ) : null}
                  {(card.firstEdition || card.setName.endsWith(" (1st Edition)")) && (
                    <span className="rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-brand-300 backdrop-blur">1st Edition</span>
                  )}
                  {card.matchDoubt && (
                    <span className="rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-amber-300/90 backdrop-blur" title={card.matchDoubt}>
                      ⚠ check
                    </span>
                  )}
                  {(card.quantity || 1) > 1 && (
                    <span className="rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-zinc-200 backdrop-blur">×{card.quantity}</span>
                  )}
                </div>

                {/* Select + Delete, top-right: hover on a mouse, always on touch. */}
                <div
                  className={`absolute right-2 top-2 flex items-center gap-1.5 transition [@media(hover:hover)]:group-hover:opacity-100 ${
                    isSelected || selected.size > 0 ? "" : "[@media(hover:hover)]:opacity-0"
                  }`}
                >
                  {!live && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onClick={(e) => toggleSelected(card.id, e.shiftKey)}
                      onChange={() => {}}
                      aria-label={`Select ${card.cardName}`}
                      className="h-5 w-5 cursor-pointer rounded border-zinc-500 bg-black/60 accent-brand-500"
                    />
                  )}
                  {(card.status !== "listed" || ended) && (
                    <button
                      onClick={() => remove(card)}
                      aria-label={`Delete ${card.cardName}`}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-zinc-300 backdrop-blur transition hover:bg-black/90 hover:text-white"
                    >
                      <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M5 5l10 10M15 5l-10 10" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* One action under the art — the thing this card needs next. */}
                <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                  <span className="truncate text-[11px] text-zinc-500">
                    {sold && card.soldPrice != null
                      ? `sold ${card.soldPrice.toFixed(2)} · net`
                      : live
                        ? "Awaiting sale"
                        : ended
                          ? formatDate(card.ebayEndedAt!)
                          : card.cardNumber
                            ? `#${card.cardNumber}`
                            : ""}
                  </span>
                  {draft && card.kind !== "sealed" ? (
                    <Link
                      href={resumeHref}
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                        card.verifiedAt
                          ? "bg-white/5 text-zinc-200 hover:bg-white/10"
                          : "bg-amber-400/15 text-amber-300 hover:bg-amber-400/25"
                      }`}
                    >
                      {card.verifiedAt ? "Build listing" : "Verify"}
                    </Link>
                  ) : live ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      {nudges[card.id] && (
                        <button
                          onClick={() => void applyReprice(card, nudges[card.id])}
                          disabled={repricing === card.id}
                          title={`Market moved ${nudges[card.id].drift > 0 ? "up" : "down"} — reprice to ${nudges[card.id].market.toFixed(2)} here and on eBay`}
                          className="rounded-full bg-amber-400/15 px-2 py-1 text-[11px] font-semibold text-amber-300 transition hover:bg-amber-400/25 disabled:opacity-50"
                        >
                          {nudges[card.id].drift > 0 ? "↑" : "↓"} ${nudges[card.id].market.toFixed(2)}
                        </button>
                      )}
                      <button
                        onClick={() => void endListing(card)}
                        disabled={ending === card.id}
                        className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
                      >
                        {ending === card.id ? "Ending…" : "End"}
                      </button>
                    </div>
                  ) : ended ? (
                    <button
                      onClick={() => void relist(card)}
                      className="shrink-0 rounded-full bg-brand-500/15 px-2.5 py-1 text-[11px] font-semibold text-brand-300 transition hover:bg-brand-500/25"
                    >
                      Relist
                    </button>
                  ) : sold && card.ebayListingUrl ? (
                    <a
                      href={card.ebayListingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-[11px] text-zinc-400 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-200"
                    >
                      eBay ↗
                    </a>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-edge bg-surface-1">
          <ul className="divide-y divide-white/5">
            {visible.map((card) => (
              <li
                key={card.id}
                // On a phone the status/price/actions cluster wraps to its
                // own right-aligned line; before it wrapped item by item and
                // the name column was squeezed to 24px — one word per line
                // ("Li… B… Edi…", Chris, 09-02).
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
              >
                <input
                  type="checkbox"
                  checked={selected.has(card.id)}
                  // onClick, not onChange: the change event has no shiftKey.
                  onClick={(e) => toggleSelected(card.id, e.shiftKey)}
                  onChange={() => {}}
                  aria-label={`Select ${card.cardName}`}
                  className="h-4 w-4 shrink-0 accent-brand-500"
                />
                <CardImage
                  // The seller's own scan photo when one is stored; catalog art otherwise.
                  src={card.photoAt ? apiPath(`/api/card-image/${card.id}?v=${card.photoAt}`) : card.imageUrl}
                  alt={card.cardName}
                  className="h-16 w-12 shrink-0 rounded-md"
                />

                <div className="min-w-[9rem] flex-1">
                  <p className="truncate text-sm font-semibold text-white">
                    {card.cardName}
                    {(card.quantity || 1) > 1 && (
                      <span className="ml-1.5 rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">
                        ×{card.quantity}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {card.setName}
                    {card.cardNumber && ` · ${card.cardNumber}`} ·{" "}
                    {card.condition}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-600">
                  {/* Status pill leads the meta line (Chris, 09-03): next to
                      the card, rows stay one height, nothing shifts. */}
                  {/* The sync stamps ebayEndedAt when the listing ended on eBay
                      without a sale; the card stays "listed" until the seller
                      decides, but the chip stops claiming it's live. */}
                  {card.status === "listed" && card.ebayEndedAt ? (
                    <span
                      className="whitespace-nowrap rounded-full bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-300"
                      title={`This listing ended on eBay without a sale (${formatDate(card.ebayEndedAt)}). Relist it, or delete the card.`}
                    >
                      Auction ended
                    </span>
                  ) : card.status === "ready" && !card.verifiedAt ? null : (
                    // An unverified draft has no chip — the amber "Verify match"
                    // button IS its state (Chris, 09-03: chip + button was
                    // redundant). It turns into this green "Active" chip.
                    <span
                      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        card.status === "ready" ? "bg-emerald-400/10 text-emerald-400" : STATUS_CHIP[card.status]
                      }`}
                      title={card.status === "ready" ? "Match verified — ready to publish" : undefined}
                    >
                      {card.status === "ready" ? "Active" : STATUS_LABEL[card.status]}
                    </span>
                  )}
                  <span>
                    Scanned {formatDate(card.createdAt)}
                    {card.status === "listed" &&
                      card.listedAt &&
                      ` · listed ${formatDate(card.listedAt)}`}
                    {card.status === "sold" &&
                      card.soldAt &&
                      ` · sold ${formatDate(card.soldAt)}`}
                    {card.ebayListingUrl ? (
                      <>
                        {" · "}
                        <a
                          href={card.ebayListingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
                        >
                          View on eBay
                        </a>
                      </>
                    ) : (
                      card.ebayOfferId && " · draft on eBay"
                    )}
                  </span>
                  </p>
                </div>

                <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
                {card.matchDoubt && (
                  <span
                    className="rounded-full border border-amber-400/30 px-2 py-0.5 text-[11px] text-amber-300/90"
                    title="The scan wasn't sure about this one — worth a close look before verifying"
                  >
                    ⚠ {card.matchDoubt}
                  </span>
                )}
                {(card.firstEdition || card.setName.endsWith(" (1st Edition)")) && (
                  <span
                    className="rounded-full border border-brand-400/40 bg-brand-500/10 px-2 py-0.5 text-[11px] font-semibold text-brand-300"
                    title="1st Edition stamp — priced and listed as its own printing"
                  >
                    1st Edition
                  </span>
                )}

                {/* The price is what a seller scans the list FOR -- it reads
                    at a glance now (Chris, 08-31: "make the prices bigger").
                    Sold rows go green like the Earned tile; the net line
                    steps up from 10px squint-size too. */}
                {/* One number per row, and it is the one the seller acts on:
                    a sold row leads with NET (the money that arrived), with
                    gross as its caption; other rows lead with the price.
                    Two same-size figures compete; a figure and its caption
                    read instantly (Chris, 08-31). */}
                <div className="w-28 text-right">
                  {soldForm?.id === card.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        confirmSold(card, soldForm.value);
                      }}
                      className="flex items-center justify-end gap-1"
                    >
                      <span className="relative">
                        <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-zinc-500">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          autoFocus
                          value={soldForm.value}
                          onChange={(e) => setSoldForm({ id: card.id, value: e.target.value })}
                          onKeyDown={(e) => e.key === "Escape" && setSoldForm(null)}
                          aria-label="Final sale price"
                          className="w-20 rounded-md border border-edge bg-black/40 py-1 pl-4 pr-1 text-right text-sm text-white outline-none focus:border-brand-400"
                        />
                      </span>
                      <button
                        type="submit"
                        className="rounded-full bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
                      >
                        ✓
                      </button>
                    </form>
                  ) : card.status === "sold" && card.soldPrice != null ? (
                    <>
                      <p
                        className="text-lg font-bold tracking-tight text-emerald-400"
                        title={card.soldFees != null ? `eBay fees $${card.soldFees.toFixed(2)} (actual)` : "eBay fees estimated"}
                      >
                        ${netAfterFees(card.soldPrice, card.soldFees).toFixed(2)}
                      </p>
                      {/* The recorded sale price is editable in place — it
                          drives the Earned tiles, so a wrong one must be one
                          click from fixed. */}
                      <button
                        onClick={() => setSoldForm({ id: card.id, value: card.soldPrice!.toFixed(2) })}
                        title="Correct the sale price"
                        className="text-xs font-medium text-zinc-400 underline decoration-zinc-700 underline-offset-2 transition hover:text-zinc-200"
                      >
                        net · sold ${card.soldPrice.toFixed(2)}
                      </button>
                      {/* The ask it was listed at — sold vs listed is the
                          seller's own pricing feedback loop at a glance. */}
                      {card.price > 0 && Math.abs(card.price - card.soldPrice) >= 0.01 && (
                        <p className="text-[11px] text-zinc-500">listed ${card.price.toFixed(2)}</p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-lg font-bold tracking-tight text-white">
                        {repricing === card.id ? "Saving…" : `$${card.price.toFixed(2)}`}
                      </p>
                      {/* Live listings only: the price changes here AND on
                          eBay (Chris, 09-04). Drafts are priced in the editor. */}
                      {isLive(card) && card.ebayOfferId && repricing !== card.id && (
                        <button
                          onClick={() => setPriceSheet(card.id)}
                          className="text-[11px] font-medium text-brand-300 underline decoration-brand-300/40 underline-offset-2 transition hover:text-brand-200"
                        >
                          Change price
                        </button>
                      )}
                      {card.status === "listed" && nudges[card.id] && (
                        <button
                          onClick={() => void applyReprice(card, nudges[card.id])}
                          disabled={repricing === card.id}
                          title={`The market moved ${nudges[card.id].drift > 0 ? "up" : "down"} ${Math.round(Math.abs(nudges[card.id].drift) * 100)}% since this listed — one click updates the price here and on the live eBay listing.`}
                          className="mt-1 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 transition hover:border-amber-400/50 hover:bg-amber-400/20 disabled:opacity-50"
                        >
                          {repricing === card.id ? (
                            "Repricing…"
                          ) : (
                            <>
                              <span aria-hidden>{nudges[card.id].drift > 0 ? "↑" : "↓"}</span>
                              Reprice to ${nudges[card.id].market.toFixed(2)}
                            </>
                          )}
                        </button>
                      )}
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {/* Back into the editor without rescanning (Chris, 09-01):
                      the scanner rebuilds this one card from the ledger row. */}
                  {card.status === "ready" && card.kind !== "sealed" && (
                    <Link
                      // Card identity rides along so the scanner can start the
                      // catalog search in parallel with the ledger fetch —
                      // sequential round trips made this feel stuck (09-02).
                      href={`/app?resume=${card.id}&rn=${encodeURIComponent(card.cardName)}&rnum=${encodeURIComponent(card.cardNumber || "")}&rg=${card.game === "mtg" ? "mtg" : "pokemon"}&ri=${encodeURIComponent(card.imageUrl || "")}${card.photoAt ? `&rp=${card.photoAt}` : ""}`}
                      // Verifying only happens on the listing screen, where
                      // the seller's photo sits beside the match (Chris,
                      // 09-03) — so an unverified draft's link IS the ask.
                      className={
                        card.verifiedAt
                          ? "rounded-full bg-brand-500/15 px-3 py-1.5 text-xs font-medium text-brand-300 transition hover:bg-brand-500/25"
                          : "rounded-full bg-amber-400/15 px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-400/25"
                      }
                    >
                      {card.verifiedAt ? "Build listing" : "Verify match"}
                    </Link>
                  )}
                  {card.status === "ready" && !card.verifiedAt && (
                    <span className="rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-500">
                      Draft
                    </span>
                  )}
                  {/* Row states (Chris, 09-03): Live → "Awaiting sale" (flips
                      to Sold on its own from eBay orders) + "Auction ended";
                      ended → Relist + Delete; sold → Sold + Delete. No
                      per-row Mark sold — eBay is the source of truth. */}
                  {card.status === "listed" && !card.ebayEndedAt && (
                    <>
                      <span
                        title="Flips to Sold on its own once eBay reports the order"
                        className="rounded-full border border-emerald-500/25 px-3 py-1.5 text-xs font-medium text-emerald-300/80"
                      >
                        Awaiting sale
                      </span>
                      <button
                        onClick={() => void endListing(card)}
                        disabled={ending === card.id}
                        className="rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-400 transition hover:border-edge-strong disabled:opacity-50"
                      >
                        {ending === card.id ? "Ending…" : "End auction"}
                      </button>
                    </>
                  )}
                  {card.status === "listed" && card.ebayEndedAt && (
                    <button
                      onClick={() => void relist(card)}
                      className="rounded-full bg-brand-500/15 px-3 py-1.5 text-xs font-medium text-brand-300 transition hover:bg-brand-500/25"
                    >
                      Relist
                    </button>
                  )}
                  {card.status === "sold" && (
                    <span className="rounded-full bg-sky-400/10 px-3 py-1.5 text-xs font-medium text-sky-300">
                      Sold
                    </span>
                  )}
                  {(card.status !== "listed" || card.ebayEndedAt) && (
                    <button
                      onClick={() => remove(card)}
                      aria-label={`Delete ${card.cardName}`}
                      className="rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-500 transition hover:border-red-400/40 hover:text-red-300"
                    >
                      Delete
                    </button>
                  )}
                </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail && (() => {
        const card = cards.find((c) => c.id === detail.id);
        if (!card) return null;
        return (
          <CardDetailModal
            card={detail.catalog}
            language="en"
            logging={false}
            loading={detail.loading}
            photo={card.photoAt ? apiPath(`/api/card-image/${card.id}?v=${card.photoAt}`) : null}
            aside={renderDetailAside(card)}
            onClose={() => setDetail(null)}
          />
        );
      })()}

      {priceSheet && (() => {
        const card = cards.find((c) => c.id === priceSheet);
        if (!card) return null;
        return (
          <RepriceSheet
            card={card}
            nudge={nudges[card.id] ?? null}
            busy={repricing === card.id}
            onClose={() => setPriceSheet(null)}
            onSubmit={(price) => {
              setPriceSheet(null);
              void setAskingPrice(card, price);
            }}
          />
        );
      })()}
    </main>
  );
}
