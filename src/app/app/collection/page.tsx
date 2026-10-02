"use client";

import { useBodyScrollLock } from "@/lib/client/useBodyScrollLock";
import { useBackToClose } from "@/lib/client/useBackToClose";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CardImage from "@/components/CardImage";
import Price from "@/components/Price";
import CardDetailModal from "@/components/CardDetailModal";
import CategorySheet, { distinctCategories } from "@/components/CategorySheet";
import CategoryManager from "@/components/CategoryManager";
import { fetchCardById, searchCards } from "@/lib/cards";
import { pickPrinting } from "@/lib/cardNumber";
import GameToggle from "@/components/GameToggle";
import InventoryValueChart from "@/components/InventoryValueChart";
import { GAME_IDS, readSavedGame, saveGame, parseGame } from "@/lib/games";
import type { GameId, PokemonCard } from "@/lib/types";
import PageSkeleton from "@/components/PageSkeleton";
import Spinner from "@/components/Spinner";
import PriceInput from "@/components/PriceInput";
import { useFocusTrap } from "@/lib/client/useFocusTrap";
import { useSession } from "@/components/SessionProvider";
import {
  deleteServerCard,
  deleteServerCards,
  fetchCategories,
  fetchLivePrices,
  fetchRepriceNudges,
  manageCategory,
  fetchServerCards,
  repriceCard,
  updateServerCard,
  type LivePrice,
  type RepriceNudge,
  type ServerCard,
} from "@/lib/client/cardsApi";
import { endEbayListing, fetchWatcherEligible, saveAutoOffer, sendWatcherOffer, syncEbaySales } from "@/lib/client/ebayApi";
import { confirmAction } from "@/components/ConfirmDialog";
import { apiPath } from "@/lib/client/basePath";
import { netAfterFees, netAfterFeesFor, POSTAGE_USD } from "@/lib/fees";
import LocalListingLine from "@/components/LocalListingLine";
import { priceFloorFor, useLocalMarket } from "@/lib/client/localMarket";
import { toLocal } from "@/lib/localPricing";
import { formatLocalAmount, marketplaceByEbayId, marketplaceLabel } from "@/lib/marketplaces";
import { askingNoteFor, ebaySoldSearchUrl, formatMoney, isFirstEditionCard } from "@/lib/listing";
import { foilChoices, foilLabel } from "@/lib/yugioh";
import { printingChoices, printingLabel } from "@/lib/onepiece";
import PriceFlagNote, { PriceFlagText, PriceStaleNote } from "@/components/PriceFlagNote";
import { priceFlagLeftOut } from "@/lib/priceFlag";
import { saleBreakdown, saleNet } from "@/lib/profit";
import { toast } from "@/components/Toaster";
import { etDate } from "@/lib/time";

/**
 * Every card the seller has ever scanned, with where it is in its life:
 * draft → listed → sold. The scanner page is a per-session workbench; this is
 * the ledger that survives closing the tab.
 */

type StatusFilter = "all" | "ready" | "listed" | "ended" | "sold" | "sealed";

/** A listing that ended on eBay without selling (seller ended it, or eBay
 *  did) — still status "listed" on the row, but not live and not in play. */
const isEnded = (c: ServerCard) => c.status === "listed" && !!c.ebayEndedAt;
const isLive = (c: ServerCard) => c.status === "listed" && !c.ebayEndedAt;

/** The listing page for a ledger row, with the hints that make reopening instant. */
function resumeHrefFor(card: ServerCard): string {
  return `/app?resume=${card.id}&rn=${encodeURIComponent(card.cardName)}&rnum=${encodeURIComponent(card.cardNumber || "")}&rg=${parseGame(card.game)}&ri=${encodeURIComponent(card.imageUrl || "")}${card.photoAt ? `&rp=${card.photoAt}` : ""}`;
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

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  // "Drafts" until 10-02 (Chris: nothing is ever marked a draft; the rows already say Not Listed).
  { value: "ready", label: "Not Listed" },
  { value: "listed", label: "Live" },
  { value: "ended", label: "Ended" },
  { value: "sold", label: "Sold" },
  // Booster boxes, ETBs, tins (Chris, 09-28: sealed can be scanned in now).
  { value: "sealed", label: "Sealed" },
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

/** "Sep 30, 2026" — the Eastern calendar day for every viewer (Chris 09-30). */
function formatDate(ts: number): string {
  return etDate(ts);
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
            {amount < 0 ? "−" : ""}{formatMoney(Math.abs(amount))}
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
  // soldByHand mirrors what the server stamps on a seller's own Mark as Sold: no eBay fee, no postage.
  return { status: "sold" as const, soldPrice: price, soldAt: Date.now(), soldByHand: true };
}

function watcherOfferNowPatch() {
  return { watcherOfferAt: Date.now() };
}

/** "Yes, this is my card": the same checkpoint the listing page writes. */
function verifiedNowPatch() {
  return { verifiedAt: Date.now(), matchDoubt: null };
}

/**
 * Mark as Sold (Chris, 10-01): a card sold off eBay still belongs in the
 * stats, so the popup asks what it went for (prefilled with the asking
 * price) and the row becomes a sold record. Bottom sheet on a phone,
 * centered on a desktop, same shape as the reprice sheet.
 */
function MarkSoldSheet({
  card,
  onClose,
  onSubmit,
}: {
  card: ServerCard;
  onClose: () => void;
  onSubmit: (price: number) => void;
}) {
  const [price, setPrice] = useState(card.price);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  useBodyScrollLock();
  useBackToClose("mark-sold", onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Mark ${card.cardName} as sold`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-up w-full max-w-md rounded-t-2xl border border-edge bg-surface-1 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/60 outline-none sm:rounded-2xl sm:p-6"
      >
        <div className="flex items-start gap-3">
          <CardImage src={card.imageUrl} alt="" className="h-16 w-12 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-semibold leading-snug text-white">Mark as Sold</p>
            <p className="line-clamp-2 text-sm leading-snug text-zinc-300 [overflow-wrap:anywhere]">{card.cardName}</p>
            <p className="truncate text-xs text-zinc-500">
              {card.setName}
              {card.cardNumber ? ` · ${card.cardNumber}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-white/5 hover:text-white"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M5 5l10 10M15 5l-10 10" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (price > 0) onSubmit(price);
          }}
        >
          <label className="mt-5 block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">What Did It Sell For?</span>
            <span className="mt-1.5 flex items-center rounded-xl border border-edge bg-black/40 px-4 focus-within:border-brand-400">
              <span className="text-2xl font-semibold text-zinc-500">$</span>
              <PriceInput
                value={price}
                onValue={setPrice}
                className="w-full bg-transparent py-3 pl-2 text-right font-display text-3xl font-semibold tracking-tight text-white outline-none"
              />
            </span>
          </label>
          <p className="mt-3 text-xs text-zinc-500">The sale counts in your stats. The card stays in Inventory as a sold record.</p>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={price <= 0}
              className="flex flex-[2] items-center justify-center rounded-full bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-default disabled:opacity-40"
            >
              Mark as Sold
            </button>
          </div>
        </form>
      </div>
    </div>
  );
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
  useBodyScrollLock();
  useBackToClose("reprice", onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A card listed on another eBay site is held to THAT site's floor and net (the card carries the site).
  const siteInfo = useLocalMarket();
  const local = card.ebayMarketplace ? siteInfo : null;
  const changed = Math.abs(price - card.price) >= 0.005;
  const net = price > 0 ? Math.max(0, netAfterFees(price) - POSTAGE_USD) : 0;
  const localNet =
    local?.rate && price > 0
      ? Math.max(0, netAfterFeesFor(local.mp, toLocal(price, local.rate), null, local.account) - local.mp.postage)
      : null;
  // Never under the fee floor (Chris, 09-08): the quick steps clamp to it and
  // a typed price under it can't be sent — the server refuses it anyway.
  const { floor, below, refusal } = priceFloorFor(local);
  const underFloor = below(price);
  const nudgeBy = (pct: number) => setPrice(Math.max(floor, Math.round(card.price * (1 + pct / 100) * 100) / 100));
  const quick: { label: string; pct: number }[] = [
    { label: "−10%", pct: -10 },
    { label: "−5%", pct: -5 },
    { label: "+5%", pct: 5 },
    { label: "+10%", pct: 10 },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Change the listing price of ${card.cardName}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-up w-full max-w-md rounded-t-2xl border border-edge bg-surface-1 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/60 outline-none sm:rounded-2xl sm:p-6"
      >
        <div className="flex items-start gap-3">
          <CardImage src={card.imageUrl} alt="" className="h-16 w-12 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-base font-semibold leading-snug text-white [overflow-wrap:anywhere]">{card.cardName}</p>
            <p className="truncate text-xs text-zinc-500">
              {card.setName}
              {card.cardNumber ? ` · ${card.cardNumber}` : ""}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Listed on eBay at{" "}
              <span className="font-semibold text-zinc-200">
                {card.ebayMarketplace && card.listPriceLocal != null
                  ? formatLocalAmount(marketplaceByEbayId(card.ebayMarketplace), card.listPriceLocal)
                  : formatMoney(card.price)}
              </span>
              {card.ebayMarketplace && card.listPriceLocal != null ? ` on ${marketplaceLabel(marketplaceByEbayId(card.ebayMarketplace))} (${formatMoney(card.price)} USD)` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-white/5 hover:text-white"
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
              onClick={() => setPrice(nudge.target)}
              className="rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:border-amber-400/50"
              title={`Today's market ${formatMoney(nudge.market)}, priced for this card's condition${nudge.target > nudge.market ? " with eBay fees and postage on top" : ""}`}
            >
              Suggested {formatMoney(nudge.target)}
            </button>
          )}
        </div>

        {local && (
          <LocalListingLine typedUsd={price} condition={card.condition} className="mt-3" />
        )}

        {underFloor ? (
          <p className="mt-4 text-xs font-medium text-red-300">{refusal()}</p>
        ) : (
          <p className="mt-4 text-xs text-zinc-500">
            You&apos;d net about{" "}
            <span className="font-semibold text-emerald-400">
              {local && localNet != null ? formatLocalAmount(local.mp, localNet) : formatMoney(net)}
            </span>{" "}
            after eBay fees and postage.
          </p>
        )}

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
            disabled={busy || !changed || price <= 0 || underFloor}
            onClick={() => onSubmit(price)}
            className="flex flex-[2] items-center justify-center gap-2 rounded-full bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:cursor-default disabled:opacity-40"
          >
            {busy && <Spinner className="h-3.5 w-3.5" />}
            {busy ? "Updating eBay…" : "Update eBay Listing"}
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
  // The money panel and the search / filter panel both fold away, and both
  // start folded on every visit (Chris, 10-02: "always collapsed unless the
  // user clicks it"), so neither is remembered.
  const [summaryOpen, setSummaryOpen] = useState(false);
  function toggleSummary() {
    setSummaryOpen((open) => !open);
  }
  const [toolsOpen, setToolsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  // "Mark sold" asks what it actually went for (prefilled with the asking
  // price) instead of silently recording the ask — the Earned tiles are only
  // as honest as this number. Also reused to correct a sold row's price.
  const [soldForm, setSoldForm] = useState<{ id: string; value: string } | null>(null);
  // "What you paid" edited in place on the card detail (09-27, profit per card).
  const [costForm, setCostForm] = useState<{ id: string; value: string } | null>(null);
  const [alertForm, setAlertForm] = useState<{ id: string; value: string } | null>(null);
  // Change a LIVE listing's price from here and the eBay listing follows, so
  // a seller never has to go to eBay (Chris, 09-04). Live rows only — a draft
  // is priced in the editor, a sold row records what it went for.
  const [priceSheet, setPriceSheet] = useState<string | null>(null);
  // Category filter (Chris, 09-04): "all" | "none" (uncategorized) | a name.
  const [categoryRaw, setCategory] = useState<string>("all");
  const [moveSheet, setMoveSheet] = useState(false);
  // One card's category, from the detail view's Category cell (Chris, 09-04).
  const [categoryTarget, setCategoryTarget] = useState<ServerCard | null>(null);
  const [moving, setMoving] = useState(false);
  // Tile art → the full card view (Chris, 09-04): everything the listing page
  // shows about the card — holo art, prices, history — plus this copy's
  // status and the one action it needs, which for drafts is "go verify /
  // list it on the listing page". Catalog rows are cached per ledger row.
  const [detail, setDetail] = useState<{ id: string; catalog: PokemonCard; loading: boolean } | null>(null);
  const catalogCache = useRef<Record<string, PokemonCard>>({});
  // Mark as Sold popup (Chris, 10-01): the ledger row it is asking about.
  const [soldSheet, setSoldSheet] = useState<string | null>(null);
  // Verify Match happens IN the detail sheet (Chris, 10-01), not on the
  // listing page. Yu-Gi-Oh! foils and One Piece printings share one number,
  // so those games ask "which one is yours?" there too: the choices per
  // ledger row, undefined while they load. "failed" = the printings could not
  // be looked up: the card is NOT verifiable until they can (Chris, 10-01:
  // both the card and its printing are confirmed before Build Listing opens).
  const [verifyChoices, setVerifyChoices] = useState<Record<string, PokemonCard[] | "failed">>({});
  const [verifying, setVerifying] = useState<string | null>(null);

  const asksPrinting = (card: ServerCard) => {
    const game = parseGame(card.game);
    return card.status === "ready" && !card.verifiedAt && card.kind !== "sealed" && (game === "yugioh" || game === "onepiece");
  };

  async function loadVerifyChoices(card: ServerCard, pick: PokemonCard) {
    if (!asksPrinting(card) || !pick.id) return;
    const game = parseGame(card.game);
    const found = await searchCards(pick.englishName || pick.name, pick.number || null, "en", undefined, game).catch(() => null);
    const choices = found === null ? ("failed" as const) : game === "yugioh" ? foilChoices(pick, found) : printingChoices(pick, found);
    setVerifyChoices((prev) => ({ ...prev, [card.id]: choices }));
  }

  /** Try Again after a failed printings lookup: the catalog card fresh by id, then its printings. */
  async function retryVerifyChoices(card: ServerCard) {
    setVerifyChoices((prev) => {
      const next = { ...prev };
      delete next[card.id];
      return next;
    });
    const pick = card.catalogCardId ? await fetchCardById(card.catalogCardId, parseGame(card.game)).catch(() => null) : null;
    if (!pick) {
      setVerifyChoices((prev) => ({ ...prev, [card.id]: "failed" }));
      return;
    }
    setDetail((d) => (d?.id === card.id ? { ...d, catalog: pick, loading: false } : d));
    await loadVerifyChoices(card, pick);
  }

  /** The seller's tap in the sheet: "yes, this one", or the printing / foil
   *  that is really theirs. A different printing is a different product, so
   *  the row follows it (name, set, picture, price) the way the listing page
   *  does, and the price is re-quoted from today's market. */
  async function verifyMatch(card: ServerCard, swap?: PokemonCard) {
    if (verifying) return;
    setVerifying(card.id);
    if (!swap || swap.id === card.catalogCardId) {
      await applyPatch(card, verifiedNowPatch());
    } else {
      setDetail((d) => (d?.id === card.id ? { ...d, catalog: swap } : d));
      await applyPatch(card, {
        cardName: swap.englishName || swap.name,
        setName: swap.setName,
        cardNumber: swap.number,
        imageUrl: swap.imageSmall,
        catalogCardId: swap.id,
        rarity: swap.rarity ?? null,
        firstEdition: isFirstEditionCard(swap),
        variant: null,
        priceLocked: false,
        scanPrice: null,
        ...verifiedNowPatch(),
      });
      const fresh = (await fetchLivePrices()).find((p) => p.cardId === card.id);
      if (fresh) {
        setLive((prev) => ({ ...prev, [card.id]: fresh }));
        // Keep the sort / In Play market in step with the row.
        setMarketById((prev) => {
          const next = { ...prev };
          if (!fresh.flag && fresh.market > 0) next[card.id] = fresh.market;
          else delete next[card.id];
          return next;
        });
        patchCard(card.id, {
          ...(fresh.applied ? { price: fresh.suggested, priceLocked: false } : {}),
          scanPrice: fresh.scanned,
        });
      }
    }
    setVerifying(null);
  }

  async function openDetail(card: ServerCard) {
    const cached = catalogCache.current[card.id];
    // A printing picked in the sheet moved the row to another catalog card: the cached one is stale.
    if (cached && (!card.catalogCardId || cached.id === card.catalogCardId)) {
      setDetail({ id: card.id, catalog: cached, loading: false });
      if (verifyChoices[card.id] === undefined || verifyChoices[card.id] === "failed") void loadVerifyChoices(card, cached);
      return;
    }
    setDetail({ id: card.id, catalog: catalogStub(card), loading: true });
    const game: GameId = parseGame(card.game);
    let found: PokemonCard | null = null;
    try {
      if (card.catalogCardId) found = await fetchCardById(card.catalogCardId, game);
      if (!found) {
        const results = await searchCards(card.cardName, card.cardNumber || null, "en", undefined, game);
        found = pickPrinting(results, card);
      }
    } catch {
      found = null;
    }
    if (found) catalogCache.current[card.id] = found;
    setDetail((d) => (d?.id === card.id ? { id: card.id, catalog: found ?? d.catalog, loading: false } : d));
    // No catalog row = the printings can't be checked, so the card can't be verified yet (Try Again).
    if (found) void loadVerifyChoices(card, found);
    else if (asksPrinting(card)) setVerifyChoices((prev) => ({ ...prev, [card.id]: "failed" }));
  }

  /** The Inventory half of the detail view: this copy's status, price, facts
   *  and actions. Makeover 09-04 (Chris: "kinda sloppy"): status header →
   *  price hero → facts strip → one primary action, quiet secondaries. */
  function renderDetailAside(card: ServerCard) {
    const live = isLive(card);
    const ended = isEnded(card);
    const sold = card.status === "sold";
    const draft = card.status === "ready";
    const href = resumeHrefFor(card);
    const primary = "inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white transition";
    const quiet = "inline-flex flex-1 items-center justify-center rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-edge-strong hover:text-white";
    const rowCls = "flex items-center justify-between gap-3 px-4 py-2.5";
    const rowLabel = "shrink-0 text-[10px] font-medium uppercase tracking-wide text-zinc-500";
    const rowValue = "flex min-w-0 justify-end text-right text-sm";
    // The price guard (lib/server/livePrices.ts): today's market is one the rule does not believe, so nothing is suggested from it.
    // Only while the price on screen is the market's: a price the seller typed (locked) is theirs and is not judged.
    const flagged = livePrices[card.id]?.flag != null && !sold && !card.priceLocked;
    const priceLabel = sold ? "Sold for" : live ? "eBay Listing Price" : ended ? "Listed At" : flagged || card.priceLocked ? "Your eBay Price" : "eBay Suggested Price";
    const priceValue = sold && card.soldPrice != null ? card.soldPrice : card.price;
    const market = marketOf(card);
    const note = sold
      ? null
      : live
        ? "Awaiting sale — flips to Sold on its own when eBay reports the order."
        : ended
          ? `Ended ${card.ebayEndedAt ? formatDate(card.ebayEndedAt) : ""} without a sale. Relist it, or delete the card.`
          : card.verifiedAt
            ? "Verified, not listed yet."
            : "Check the match against your photo before listing.";
    // Why a cheap draft sits above its market (value + fees + postage): only
    // while the price IS the suggested one, not a price the seller typed.
    const lp = livePrices[card.id];
    const costNote = draft && lp && !lp.flag && Math.abs(card.price - lp.suggested) < 0.005 ? askingNoteFor(lp.market, card.condition) : null;
    const facts: [string, string][] = [
      ...(card.rarity ? ([["Rarity", card.rarity]] as [string, string][]) : []),
      ["Condition", card.condition],
      ["Copies", String(card.quantity || 1)],
      ["Added", formatDate(card.createdAt)],
      ...(card.listedAt ? ([["Listed", formatDate(card.listedAt)]] as [string, string][]) : []),
      ...(sold && card.soldAt ? ([["Sold", formatDate(card.soldAt)]] as [string, string][]) : []),
    ];
    const status = live ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
        Live on eBay
      </span>
    ) : ended ? (
      <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300">Auction ended</span>
    ) : sold ? (
      <span className="rounded-full bg-sky-400/10 px-3 py-1 text-xs font-semibold text-sky-300">Sold</span>
    ) : card.verifiedAt ? (
      <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-400">Active</span>
    ) : (
      <span className="rounded-full bg-amber-400/90 px-3 py-1 text-xs font-semibold text-black">Verify match</span>
    );
    // Sold rows are the record: never deleted, never relisted, always
    // viewable (Chris, 09-08). Live rows end first; ended/drafts delete.
    const canDelete = (card.status !== "listed" || ended) && !sold;
    return (
      <div className="overflow-hidden rounded-2xl border border-edge bg-surface-1">
        {/* Status header */}
        <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-3">
          {status}
          {(card.firstEdition || card.setName.endsWith(" (1st Edition)")) && (
            <span className="rounded-full border border-brand-400/40 bg-brand-500/10 px-2.5 py-1 text-xs font-semibold text-brand-300">1st Edition</span>
          )}
          {card.matchDoubt && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 px-2.5 py-1 text-xs text-amber-300/90">
              <span aria-hidden>⚠</span> {card.matchDoubt}
            </span>
          )}
        </div>

        {/* Price hero. Unsold (Chris, 10-02): the Market price leads, the
            price Build Listing would publish sits beside it. Sold rows keep
            the one sale figure. */}
        <div className="px-4 pb-4 pt-4">
          {!sold && (
            <dl className="mb-1 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-edge bg-edge">
              <div className="bg-black/25 px-3 py-2.5">
                <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Market Price</dt>
                <dd className="mt-0.5 font-display text-2xl font-bold tracking-tight text-white">
                  {market != null ? formatMoney(market) : !liveLoaded && card.catalogCardId ? "…" : "—"}
                </dd>
              </div>
              <div className="bg-black/25 px-3 py-2.5">
                <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{priceLabel}</dt>
                <dd className="mt-0.5 font-display text-2xl font-bold tracking-tight text-zinc-200">
                  {card.price > 0 ? formatMoney(card.price) : "—"}
                </dd>
              </div>
            </dl>
          )}
          {sold && <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{priceLabel}</div>}
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {sold && (
              <span className="font-display text-3xl font-bold tracking-tight text-emerald-400">
                {formatMoney(priceValue)}
              </span>
            )}
            {sold && card.soldPrice != null && (() => {
              const b = saleBreakdown(card)!;
              // With a purchase price on file the caption is the real profit;
              // without one it is the take-home after fees and postage.
              return (
                <span className="text-sm text-zinc-400">
                  {b.costKnown ? "profit " : "you keep "}
                  <span className={`font-semibold ${b.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {b.profit < 0 ? "−" : ""}{formatMoney(Math.abs(b.profit))}
                  </span>
                  {b.byHand
                    ? b.costKnown ? " after what you paid (marked by hand: no eBay fee or postage)" : ", marked by hand: no eBay fee or postage"
                    : b.costKnown ? ` after ${b.feesActual ? "" : "estimated "}fees, postage and what you paid` : ` after ${b.feesActual ? "" : "estimated "}fees and postage`}
                </span>
              );
            })()}
            {live && card.ebayOfferId && (
              <button
                type="button"
                onClick={() => {
                  setDetail(null);
                  setPriceSheet(card.id);
                }}
                className="text-sm font-medium text-brand-300 underline-offset-4 transition hover:text-brand-200 hover:underline"
              >
                Change price
              </button>
            )}
          </div>
          {flagged && !live && !ended && <PriceFlagNote className="mt-2" soldUrl={ebaySoldSearchUrl(catalogStub(card), { firstEdition: card.firstEdition })} />}
          {/* The market has not updated in 45+ days (10-02): the number stands (above), this says how old it is. */}
          {!flagged && !sold && lp?.stale && <PriceStaleNote className="mt-1.5" days={lp.stale.days} soldUrl={ebaySoldSearchUrl(catalogStub(card), { firstEdition: card.firstEdition })} />}
          {costNote && <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">{costNote}</p>}
          {note && <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{note}</p>}
          {/* Added → now (Chris, 09-08): the price when the card was added,
              the price today, and the move in $ and %. Both sides are the
              MARKET price since 10-02 (the hero leads with it): the market on
              the day it was added against today's. Sold rows tell the sale
              story instead. */}
          {(() => {
            const scanned = lp?.marketThen ?? null;
            if (sold || flagged || market == null || scanned == null || !(scanned > 0)) return null;
            const delta = market - scanned;
            if (Math.abs(delta) < 0.01) {
              return <p className="mt-2 text-xs text-zinc-500">Unchanged since it was added at {formatMoney(scanned)}.</p>;
            }
            const up = delta > 0;
            const pct = (Math.abs(delta) / scanned) * 100;
            return (
              <dl className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-edge bg-edge text-sm">
                <div className="bg-black/25 px-3 py-2">
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Added at</dt>
                  <dd className="font-display font-semibold text-zinc-300">{formatMoney(scanned)}</dd>
                </div>
                <div className="bg-black/25 px-3 py-2">
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Now</dt>
                  <dd className="font-display font-semibold text-white">{formatMoney(market)}</dd>
                </div>
                <div className="bg-black/25 px-3 py-2">
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Change</dt>
                  <dd className={`font-display font-semibold ${up ? "text-emerald-400" : "text-rose-400"}`}>
                    <span aria-hidden>{up ? "↑" : "↓"}</span> {formatMoney(Math.abs(delta))}
                    <span className="ml-1 text-xs font-medium opacity-80">({pct.toFixed(1)}%)</span>
                  </dd>
                </div>
              </dl>
            );
          })()}
        </div>

        {/* Facts strip */}
        <dl className="grid grid-cols-3 gap-px border-y border-edge bg-edge">
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0 bg-surface-1 px-4 py-2.5">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
              <dd className="truncate text-sm text-zinc-100">{value}</dd>
            </div>
          ))}
          {facts.length % 3 !== 0 &&
            Array.from({ length: 3 - (facts.length % 3) }).map((_, i) => <div key={`pad-${i}`} className="bg-surface-1" />)}
        </dl>

        {/* The seller's own notes, one full row each: label left, value
            right. They were 3-col cells and the text got cut off on phones
            (Chris, 09-28: "too bunched up"). */}
        <dl className="divide-y divide-edge border-b border-edge">
          {/* What you paid (09-27): tap to type it; it feeds profit and the year-end report. */}
          <div className={rowCls}>
            <dt className={rowLabel}>You paid</dt>
            <dd className={rowValue}>
              {costForm?.id === card.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const n = costForm.value.trim() === "" ? null : Math.max(0, Math.round((parseFloat(costForm.value) || 0) * 100) / 100);
                    void applyPatch(card, { costBasis: n });
                    setCostForm(null);
                  }}
                  className="flex items-center gap-1"
                >
                  <span className="relative">
                    <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-zinc-500">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      autoFocus
                      value={costForm.value}
                      onChange={(e) => setCostForm({ id: card.id, value: e.target.value })}
                      onKeyDown={(e) => e.key === "Escape" && setCostForm(null)}
                      aria-label="What you paid"
                      className="w-20 rounded-md border border-edge bg-black/40 py-0.5 pl-4 pr-1 text-base text-white outline-none focus:border-brand-400 sm:text-sm"
                    />
                  </span>
                  <button type="submit" className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-black transition hover:bg-emerald-400">
                    Save
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setCostForm({ id: card.id, value: card.costBasis != null ? card.costBasis.toFixed(2) : "" })}
                  className={`inline-flex max-w-full items-center gap-1 underline-offset-4 transition hover:underline ${
                    card.costBasis != null ? "text-zinc-100 hover:text-white" : "text-brand-300 hover:text-brand-200"
                  }`}
                >
                  <span className="truncate">{card.costBasis != null ? formatMoney(card.costBasis) : "Add what you paid"}</span>
                </button>
              )}
            </dd>
          </div>
          {/* Price alert on an owned card (09-27): email when the market-based asking price reaches the target. Sold rows have nothing to watch. */}
          {!sold && (
            <div className={rowCls}>
              <dt className={rowLabel}>Alert me at</dt>
              <dd className={rowValue}>
                {alertForm?.id === card.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const n = parseFloat(alertForm.value);
                      void applyPatch(card, { alertPrice: Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null });
                      setAlertForm(null);
                    }}
                    className="flex items-center gap-1"
                  >
                    <span className="relative">
                      <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-zinc-500">$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        autoFocus
                        value={alertForm.value}
                        onChange={(e) => setAlertForm({ id: card.id, value: e.target.value })}
                        onKeyDown={(e) => e.key === "Escape" && setAlertForm(null)}
                        aria-label="Alert me at"
                        className="w-20 rounded-md border border-edge bg-black/40 py-0.5 pl-4 pr-1 text-base text-white outline-none focus:border-brand-400 sm:text-sm"
                      />
                    </span>
                    {/* A worded Save (Chris, 09-28): "not many people are going to know to hit return". */}
                    <button type="submit" className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-black transition hover:bg-emerald-400">
                      Save
                    </button>
                    {card.alertPrice != null && (
                      <button type="button" onClick={() => { void applyPatch(card, { alertPrice: null }); setAlertForm(null); }} className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300">
                        Clear
                      </button>
                    )}
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAlertForm({ id: card.id, value: card.alertPrice != null ? card.alertPrice.toFixed(2) : priceValue > 0 ? priceValue.toFixed(2) : "" })}
                    title="Get an email when this card reaches your price (checked daily)"
                    className={`inline-flex max-w-full items-center gap-1 underline-offset-4 transition hover:underline ${
                      card.alertPrice != null ? "text-amber-200 hover:text-amber-100" : "text-brand-300 hover:text-brand-200"
                    }`}
                  >
                    <span className="truncate">{card.alertPrice != null ? `🔔 ${formatMoney(card.alertPrice)}${card.alertedAt ? " · sent" : ""}` : "Set a price alert"}</span>
                  </button>
                )}
              </dd>
            </div>
          )}
          {/* Category is a link: add one, or change it (Chris, 09-04). */}
          <div className={rowCls}>
            <dt className={rowLabel}>Category</dt>
            <dd className={rowValue}>
              <button
                type="button"
                onClick={() => setCategoryTarget(card)}
                className={`inline-flex max-w-full items-center gap-1.5 underline-offset-4 transition hover:underline ${
                  card.category ? "text-zinc-100 hover:text-white" : "text-brand-300 hover:text-brand-200"
                }`}
              >
                <span className="truncate">{card.category ?? "Add to category"}</span>
                {card.category && <span className="text-[10px] text-zinc-500">change</span>}
              </button>
            </dd>
          </div>
        </dl>

        {/* Actions: one primary, then the quiet row */}
        <div className="flex flex-col gap-2 p-4">
          {draft && card.kind !== "sealed" && card.verifiedAt && (
            <Link href={href} className={`${primary} bg-brand-500 hover:bg-brand-400`}>
              Build the Listing →
            </Link>
          )}
          {/* Verifying happens right here (Chris, 10-01): the photo and the
              match are on the stage beside this panel. One tap, or the
              printing / foil pick for the games that have several per number. */}
          {draft && card.kind !== "sealed" && !card.verifiedAt && (() => {
            const choices = asksPrinting(card) ? verifyChoices[card.id] : [];
            const busy = verifying === card.id;
            const onePiece = parseGame(card.game) === "onepiece";
            return (
              <div className="flex flex-col gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4">
                <div className="min-w-0">
                  <p className="font-display text-lg font-semibold text-white">Is This Your Card?</p>
                  <p className="mt-0.5 text-sm text-zinc-400">Same name, set and number as the one in your hand?</p>
                </div>
                {choices === undefined || detail?.loading ? (
                  <p className="flex items-center justify-center gap-2 py-2 text-sm text-zinc-400">
                    <Spinner className="h-3.5 w-3.5" /> Checking the printings…
                  </p>
                ) : choices === "failed" ? (
                  // No plain "Yes" here: a One Piece / Yu-Gi-Oh! card is only
                  // verified once its printing was confirmed too.
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-amber-200">Couldn&apos;t load this card&apos;s printings, so it can&apos;t be verified yet.</p>
                    <button
                      type="button"
                      onClick={() => void retryVerifyChoices(card)}
                      className="w-full rounded-full bg-amber-400 px-5 py-3 text-sm font-semibold text-black transition hover:bg-amber-300"
                    >
                      Try Again
                    </button>
                  </div>
                ) : choices.length >= 2 ? (
                  <div>
                    <p className="text-sm font-medium text-white">
                      {onePiece ? "Which printing is yours? Tap it to confirm." : "Which foil is yours? Tap it to confirm."}
                    </p>
                    <div className="mt-2 grid grid-cols-1 gap-2">
                      {choices.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          disabled={busy}
                          onClick={() => void verifyMatch(card, c)}
                          className={`flex items-center justify-center gap-3 rounded-full px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
                            c.id === card.catalogCardId
                              ? "bg-emerald-500 text-white hover:bg-emerald-400"
                              : "border border-edge text-zinc-200 hover:border-edge-strong hover:text-white"
                          }`}
                        >
                          {onePiece && c.imageSmall ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={c.imageSmall} alt="" className="h-9 w-[26px] shrink-0 rounded-sm object-cover" />
                          ) : null}
                          <span>{onePiece ? printingLabel(c) : foilLabel(c)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void verifyMatch(card)}
                    className="w-full rounded-full bg-emerald-500 px-5 py-3.5 text-base font-semibold text-white transition hover:bg-emerald-400 disabled:opacity-50"
                  >
                    Yes, This Is My Card
                  </button>
                )}
                {/* A wrong card entirely is fixed where every printing can be browsed. */}
                <Link href={href} className="text-center text-xs text-brand-300 underline underline-offset-4 hover:text-brand-200">
                  Not Your Card? Fix It on the Listing Page
                </Link>
              </div>
            );
          })()}
          {live && card.ebayListingUrl && (
            <a href={card.ebayListingUrl} target="_blank" rel="noopener noreferrer" className={`${primary} bg-ebay hover:bg-ebay-hover`}>
              View on eBay ↗
            </a>
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
          {(live || (sold && card.ebayListingUrl) || canDelete) && (
            <div className="flex gap-2">
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
              {sold && card.ebayListingUrl && (
                <a href={card.ebayListingUrl} target="_blank" rel="noopener noreferrer" className={quiet}>
                  View the Sale on eBay ↗
                </a>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => {
                    setDetail(null);
                    setSoldSheet(card.id);
                  }}
                  className={quiet}
                >
                  Mark as Sold
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => {
                    setDetail(null);
                    void remove(card);
                  }}
                  className="inline-flex flex-1 items-center justify-center rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-400 transition hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-300"
                >
                  Delete
                </button>
              )}
            </div>
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
      `/app?resume=${card.id}&rn=${encodeURIComponent(card.cardName)}&rnum=${encodeURIComponent(card.cardNumber || "")}&rg=${parseGame(card.game)}&ri=${encodeURIComponent(card.imageUrl || "")}${card.photoAt ? `&rp=${card.photoAt}` : ""}`,
    );
  }
  const [syncError, setSyncError] = useState<string | null>(null);
  // Listed cards the market has moved away from (keyed by card id).
  const [nudges, setNudges] = useState<Record<string, RepriceNudge>>({});
  /** Today's market per row (lib/server/livePrices.ts) — drafts the seller
   *  never priced by hand were repriced server-side and carry applied. */
  const [livePrices, setLive] = useState<Record<string, LivePrice>>({});
  // False until the live-price request has answered, so a row waits ("…")
  // instead of showing its eBay price and then swapping to the market.
  const [liveLoaded, setLiveLoaded] = useState(false);
  // Today's Market price per row id (believed markets only): what the price
  // sort orders by. Its own state, set with livePrices, so the sort's memo
  // has a plain dependency.
  const [marketById, setMarketById] = useState<Record<string, number>>({});
  /** Today's Market price for a row: the number every unsold card leads with
   *  (Chris, 10-02). Null when the catalog has none or the price guard flags it. */
  function marketOf(card: ServerCard): number | null {
    const lp = livePrices[card.id];
    return lp && !lp.flag && lp.market > 0 ? lp.market : null;
  }
  /** The headline text of an unsold row: the Market price, the row's own
   *  price when there is no market (sealed, no catalog match, flagged). */
  function headlineOf(card: ServerCard): string {
    const market = marketOf(card);
    if (market != null) return formatMoney(market);
    if (!liveLoaded && card.catalogCardId && card.status !== "sold") return "…";
    return formatMoney(card.price);
  }
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
        if (cancelled) return;
        // null = the request failed (timeout, 5xx). Keep whatever rows are
        // showing and say so — an empty ledger here used to read as
        // "No cards yet" on a bad connection.
        if (list) setCards(list);
        else setSyncError("Couldn't load your cards — check your connection and pull to refresh.");
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
    // Live prices: today's market from our own series, drafts repriced in
    // place (Chris, 09-07: the scan-time price never updated).
    void fetchLivePrices().then((list) => {
      if (cancelled) return;
      setLiveLoaded(true);
      if (list.length === 0) return;
      setLive(Object.fromEntries(list.map((p) => [p.cardId, p])));
      setMarketById(Object.fromEntries(list.filter((p) => !p.flag && p.market > 0).map((p) => [p.cardId, p.market])));
      const byId = new Map(list.map((p) => [p.cardId, p]));
      setCards((prev) =>
        prev.map((c) => {
          const p = byId.get(c.id);
          if (!p) return c;
          const next = { ...c };
          if (p.applied) {
            next.price = p.suggested;
            next.priceLocked = false;
          }
          // Older rows get their scan-time price backfilled server-side.
          if (c.scanPrice == null && p.scanned != null) next.scanPrice = p.scanned;
          return next;
        }),
      );
    });
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
    await setAskingPrice(card, nudge.target);
  }

  /** Writes a new asking price to the ledger and, when the card has an eBay
   *  offer (draft or live), onto that offer too — in place, no relist. */
  async function setAskingPrice(card: ServerCard, price: number) {
    if (Math.abs(price - card.price) < 0.005) return;
    if (!card.ebayOfferId) {
      await applyPatch(card, { price, priceLocked: true });
      toast(`${card.cardName} is now ${formatMoney(price)}`);
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
        onClick: () => router.push("/help#reprice"),
      });
      return;
    }
    patchCard(card.id, { price });
    toast(`${card.cardName} repriced to ${formatMoney(price)}${result.ebayUpdated ? " — eBay listing updated" : ""}`);
    setNudges((prev) => {
      const next = { ...prev };
      delete next[card.id];
      return next;
    });
    if (card.ebayListingUrl && !result.ebayUpdated) {
      setSyncError(
        `${card.cardName} is ${formatMoney(price)} here now, but eBay didn't take the change${result.ebayError ? ` (${result.ebayError})` : ""} — update the live listing on eBay.`,
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
    toast(`${card.cardName} sold — ${formatMoney(price)}`);
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
        message: `Send ${pct}% off ${card.cardName} (${formatMoney(card.price)} → ${formatMoney(discounted)}) to everyone watching it? This emails real buyers and can't be recalled.`,
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
  const gameCounts = useMemo(() => {
    const counts: Partial<Record<GameId, number>> = {};
    for (const g of GAME_IDS) counts[g] = 0;
    for (const c of cards) counts[c.game ?? "pokemon"] = (counts[c.game ?? "pokemon"] ?? 0) + 1;
    return counts;
  }, [cards]);
  // Categories = the ones cards carry + the empty ones the seller created
  // (server table, 09-08 "add category"); both lists merge here.
  const [createdCategories, setCreatedCategories] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void fetchCategories().then((list) => {
      if (!cancelled) setCreatedCategories(list);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  const categories = useMemo(
    () => distinctCategories([...cards, ...createdCategories.map((category) => ({ category }))]),
    [cards, createdCategories],
  );
  // Category management sheet (Chris, 09-08): add / rename / merge / delete.
  const [manageFolders, setManageFolders] = useState(false);
  const [folderBusy, setFolderBusy] = useState<string | null>(null);
  async function addFolder(name: string): Promise<boolean> {
    setFolderBusy("");
    const r = await manageCategory("add", name);
    setFolderBusy(null);
    if (!r.ok) {
      toast(r.error ?? "Couldn't add the category", "err");
      return false;
    }
    setCreatedCategories((prev) => (prev.includes(name) ? prev : [...prev, name]));
    toast(`Category ${name} added`);
    return true;
  }
  async function renameFolder(from: string, to: string): Promise<boolean> {
    setFolderBusy(from);
    const r = await manageCategory("rename", from, to);
    setFolderBusy(null);
    if (!r.ok) {
      toast(r.error ?? "Couldn't rename the category", "err");
      return false;
    }
    setCards((prev) => prev.map((c) => (c.category === from ? { ...c, category: to } : c)));
    setCreatedCategories((prev) => [...prev.filter((c) => c !== from), to]);
    if (categoryRaw === from) setCategory(to);
    toast(`${from} → ${to} (${r.changed} card${r.changed === 1 ? "" : "s"})`);
    return true;
  }
  async function deleteFolder(name: string): Promise<boolean> {
    const n = cards.filter((c) => c.category === name).length;
    if (
      !(await confirmAction({
        message:
          n > 0
            ? `Delete the category "${name}"? Its ${n} card${n === 1 ? "" : "s"} stay in your Inventory as Uncategorized.`
            : `Delete the category "${name}"?`,
        confirmLabel: "Delete category",
        danger: true,
      }))
    )
      return false;
    setFolderBusy(name);
    const r = await manageCategory("delete", name);
    setFolderBusy(null);
    if (!r.ok) {
      toast(r.error ?? "Couldn't delete the category", "err");
      return false;
    }
    setCards((prev) => prev.map((c) => (c.category === name ? { ...c, category: null } : c)));
    setCreatedCategories((prev) => prev.filter((c) => c !== name));
    if (categoryRaw === name) setCategory("all");
    toast(n > 0 ? `Category ${name} deleted — ${r.changed} card${r.changed === 1 ? "" : "s"} uncategorized` : `Category ${name} deleted`);
    return true;
  }
  // Filtering on a category, then emptying it, left "Nothing matches" with
  // no chip to clear it (QA, 09-04) — a vanished category reads as All.
  const category =
    categoryRaw === "all" || (categoryRaw === "none" ? categories.length > 0 : categories.includes(categoryRaw))
      ? categoryRaw
      : "all";
  // What the folded search / filter line says when something narrows the list.
  const narrowedBy = [
    filter !== "all" ? FILTERS.find((f) => f.value === filter)?.label : null,
    category === "none" ? "Uncategorized" : category !== "all" ? category : null,
    query.trim() ? `"${query.trim()}"` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  function switchGame(next: GameId) {
    setGameView(next);
    setSelected(new Set());
    saveGame(next);
  }

  // The price guard: drafts priced off a market the rule does not believe (and not typed by the seller) count for nothing
  // in what is in play, so one junk $1,013 draft cannot double the number. A key, so the memo depends on a plain string.
  // The tab and the category pick the pile (Chris, 10-02: "the in play section should reflect the card results at
  // the bottom ... if you change tabs and categories", the way it already followed the game). The money panel, the
  // value line, the counts and the list are all this pile; the search box only narrows the list.
  const scopeCards = useMemo(
    () =>
      gameCards.filter((card) => {
        if (category === "none" ? card.category !== null : category !== "all" && card.category !== category) return false;
        if (filter === "listed" && !isLive(card)) return false;
        if (filter === "ended" && !isEnded(card)) return false;
        if ((filter === "ready" || filter === "sold") && card.status !== filter) return false;
        if (filter === "sealed" && card.kind !== "sealed") return false;
        return true;
      }),
    [gameCards, filter, category],
  );
  const scoped = filter !== "all" || category !== "all";
  const scopeLabel = [
    filter !== "all" ? FILTERS.find((f) => f.value === filter)?.label : null,
    category === "none" ? "Uncategorized" : category !== "all" ? category : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const leftOutKey = scopeCards
    .filter((c) => c.status === "ready" && !c.priceLocked && livePrices[c.id]?.flag != null)
    .map((c) => c.id)
    .join(",");
  const stats = useMemo(() => {
    const drafts = scopeCards.filter((c) => c.status === "ready");
    // "1 live" while nothing was live (Chris, 09-03): an ended auction is
    // neither live nor in play — it waits for Relist or Delete.
    const listed = scopeCards.filter(isLive);
    const ended = scopeCards.filter(isEnded);
    const sold = scopeCards.filter((c) => c.status === "sold");

    const earned = sold.reduce((sum, c) => sum + (c.soldPrice ?? 0), 0);
    // Net = after eBay fees AND the postage the seller pays per sale (Chris,
    // 09-03: the tiles "should also reflect after ebay fees and shipping").
    // A sale marked by hand (off eBay) keeps the whole price (Chris, 10-01).
    const net = sold.reduce((sum, c) => sum + saleNet(c), 0);
    // Every sale has its real fee recorded → the fee figure drops its "≈".
    const feesExact = sold.every((c) => c.soldPrice == null || c.soldFees != null || c.soldByHand);
    // Postage only comes off eBay sales.
    const postedCopies = sold.filter((c) => c.soldPrice != null && !c.soldByHand).length;
    const handSold = sold.filter((c) => c.soldPrice != null && c.soldByHand);
    const handCount = handSold.length;
    const handEarned = handSold.reduce((sum, c) => sum + (c.soldPrice ?? 0), 0);
    // Seller-typed and listed prices count; a flagged unlocked draft does not (leftOutKey above).
    const leftOutIds = new Set(leftOutKey ? leftOutKey.split(",") : []);
    const leftOut = drafts.filter((c) => leftOutIds.has(c.id));
    const counted = [...drafts.filter((c) => !leftOut.includes(c)), ...listed];
    const inPlayGross = counted.reduce((sum, c) => sum + c.price * (c.quantity || 1), 0);
    // The total of the rows (Chris, 10-02): each unsold card at the number its row shows, the Market
    // price, or the row's own price where there is no market (same fallback as headlineOf).
    const inPlayMarket = counted.reduce((sum, c) => sum + (marketById[c.id] ?? c.price) * (c.quantity || 1), 0);
    // What those listings would actually put in the seller's pocket: each
    // copy after the fee estimate and postage.
    const inPlay = counted.reduce(
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

    const inPlayCopies = counted.reduce((sum, c) => sum + (c.price > 0 ? c.quantity || 1 : 0), 0);
    const soldCopies = sold.filter((c) => c.soldPrice != null).length;
    // Profit (09-27) = net take-home minus what the seller paid; only sales
    // with a purchase price on file count toward cost, the rest are flagged.
    const cost = sold.reduce((sum, c) => sum + (c.soldPrice != null ? c.costBasis ?? 0 : 0), 0);
    const costKnown = sold.filter((c) => c.soldPrice != null && c.costBasis != null).length;
    const profit = net - cost;
    return { drafts, listed, ended, sold, earned, net, feesExact, inPlay, inPlayGross, inPlayMarket, inPlayCopies, leftOut: leftOut.length, soldCopies, postedCopies, handCount, handEarned, avgDays, cost, costKnown, profit };
  }, [scopeCards, leftOutKey, marketById]);


  async function removeSelected() {
    // Same rule as the row's Delete button: live listings end first, sold
    // rows are the record, ended auctions and drafts go.
    const ids = [...selected].filter((id) => {
      const card = cards.find((c) => c.id === id);
      return card && (card.status !== "listed" || isEnded(card)) && card.status !== "sold";
    });
    if (ids.length === 0) return;
    if (!(await confirmAction({ message: `Remove ${ids.length} card${ids.length === 1 ? "" : "s"} from your collection? This can't be undone.`, confirmLabel: `Delete ${ids.length}` }))) return;
    setBulkDeleting(true);
    setSyncError(null);
    setCards((prev) => prev.filter((c) => !ids.includes(c.id)));
    // One request for the lot (09-09): 88 parallel deletes once lost every
    // reply while the server had removed the rows. If this one fails, ask the
    // server what is really there instead of guessing from memory.
    const result = await deleteServerCards(ids);
    if (!result) {
      const list = await fetchServerCards();
      if (list) setCards(list);
      setSyncError("Couldn't confirm the delete — check your connection. The list shows what is really there.");
      toast("Couldn't confirm the delete", "err");
    } else {
      toast(`${result.removed} card${result.removed === 1 ? "" : "s"} removed`);
    }
    setSelected(new Set());
    setBulkDeleting(false);
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const shown = scopeCards.filter((card) => {
      if (!needle) return true;
      return (
        card.cardName.toLowerCase().includes(needle) ||
        card.setName.toLowerCase().includes(needle) ||
        card.cardNumber.toLowerCase().includes(needle)
      );
    });
    if (sort === "newest") return shown; // the server's own order
    // Sorts by the number the row shows: the sale price, else the Market price, else the row's own.
    const shownPrice = (c: ServerCard) => c.soldPrice ?? marketById[c.id] ?? c.price;
    return [...shown].sort((a, b) => {
      if (sort === "price") {
        return shownPrice(b) - shownPrice(a);
      }
      if (sort === "rarity") {
        const byRarity = rarityRank(a.rarity) - rarityRank(b.rarity);
        return byRarity !== 0 ? byRarity : shownPrice(b) - shownPrice(a);
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
  }, [scopeCards, query, sort, marketById]);

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
        {gameView === "pokemon" && (
          <div className="flex items-center gap-4">
            <Link href="/app/collection/import" className="text-xs font-medium text-brand-300 underline-offset-4 transition hover:text-brand-200 hover:underline">
              Import CSV →
            </Link>
            <Link href="/app/collection/sets" className="text-xs font-medium text-brand-300 underline-offset-4 transition hover:text-brand-200 hover:underline">
              Set Completion →
            </Link>
            <Link href="/app/collection/insights" className="text-xs font-medium text-brand-300 underline-offset-4 transition hover:text-brand-200 hover:underline">
              Insights →
            </Link>
          </div>
        )}
      </div>
      {/* Its own full-width row, counts inside the pills: the compact corner
          switch was invisible on a phone (Chris, 09-06: "inventory needs a
          button to switch between pokemon and magic" — it had one). */}
      <GameToggle game={gameView} onChange={switchGame} counts={gameCounts} block />

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
        {/* Says which pile the numbers are for, with the way back to everything. */}
        {scoped && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-edge/60 bg-brand-500/[0.07] px-5 py-2 text-xs">
            <span className="text-zinc-300">
              Showing <span className="font-semibold text-white">{scopeLabel}</span> · {scopeCards.length} card{scopeCards.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={() => {
                setFilter("all");
                setCategory("all");
              }}
              className="font-medium text-brand-300 underline-offset-4 transition hover:text-brand-200 hover:underline"
            >
              Show Everything
            </button>
          </div>
        )}
        {/* The whole panel folds to one line (Chris, 10-02: "make this section collapsible on desktop and
            mobile"); folded on every visit until it is tapped. Folded, the line carries the two headline numbers. */}
        <button
          type="button"
          onClick={toggleSummary}
          aria-expanded={summaryOpen}
          aria-controls="inventory-summary"
          className={`flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left transition hover:bg-white/[0.03] ${summaryOpen ? "border-b border-edge/60" : ""}`}
        >
          {summaryOpen ? (
            <span className="text-xs uppercase tracking-[0.15em] text-zinc-500">Summary</span>
          ) : (
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-0.5 text-xs text-zinc-400">
              <span className="whitespace-nowrap">
                In Play <span className="font-display text-sm font-semibold tabular-nums text-white">{liveLoaded ? formatMoney(stats.inPlayMarket) : "…"}</span>
              </span>
              <span className="whitespace-nowrap">
                Earned <span className="font-display text-sm font-semibold tabular-nums text-emerald-400">{formatMoney(stats.net)}</span>
              </span>
            </span>
          )}
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-brand-300">
            {summaryOpen ? "Hide" : "Show"}
            <svg viewBox="0 0 20 20" className={`h-4 w-4 transition-transform ${summaryOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 8l5 5 5-5" />
            </svg>
          </span>
        </button>
        <div id="inventory-summary" className={summaryOpen ? "" : "hidden"}>
        <div className="grid sm:grid-cols-2 sm:divide-x sm:divide-edge/60">
          <div className="p-5">
            <p className="flex min-h-6 items-center text-xs uppercase tracking-[0.15em] text-zinc-500">In play</p>
            {/* Two balances side by side (Chris, 10-02: "show the balance with and without ebay"): what the pile
                puts in the pocket sold on eBay, and off eBay = the total of the rows, every card at its Market
                price (Chris, later 10-02: "that should be the total of the rows"). The folded line shows the
                same rows total. The ledger under them explains the On eBay figure only. */}
            <div className="mt-1.5 grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-zinc-400">On eBay</p>
                <p className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  {/* The eBay prices added up, BEFORE fees (Chris, 10-02: the after-fees figure up here "feels
                      off" beside a no-fees market total); what is kept after fees is the ledger's last line. */}
                  <Price usd={stats.inPlayGross} usdClassName="mt-1 text-xs font-normal tracking-normal text-zinc-500" />
                </p>
                <p className="text-[11px] leading-snug text-zinc-500">eBay Prices, Before Fees</p>
              </div>
              <div className="min-w-0 border-l border-edge/60 pl-3">
                <p className="text-[11px] font-medium text-zinc-400">Off eBay</p>
                <p className="font-display text-2xl font-semibold tracking-tight text-zinc-200 sm:text-3xl">
                  {/* Waits for the live prices: before they answer the sum would be the eBay prices. */}
                  {liveLoaded ? <Price usd={stats.inPlayMarket} usdClassName="mt-1 text-xs font-normal tracking-normal text-zinc-500" /> : "…"}
                </p>
                <p className="text-[11px] leading-snug text-zinc-500">Market Prices, No Fees</p>
              </div>
            </div>
            {stats.leftOut > 0 && (
              <p className="mt-1 text-xs text-amber-300">
                {priceFlagLeftOut(stats.leftOut)}
              </p>
            )}
            <Breakdown
              rows={[
                ["eBay fees (est.)", -(stats.inPlayGross - stats.inPlay - stats.inPlayCopies * POSTAGE_USD)],
                [`Postage · ${stats.inPlayCopies} × ${formatMoney(POSTAGE_USD)}`, -(stats.inPlayCopies * POSTAGE_USD)],
                ["You Keep on eBay", stats.inPlay],
              ]}
            />
          </div>
          <div className="border-t border-edge/60 p-5 sm:border-t-0">
            {/* The big number is the money that actually reached the seller —
                net after eBay fees and postage, same as the admin panel leads
                with (Chris, 08-31: sellers need to see the sale the way admin
                does). */}
            {/* Same shape as In Play (Chris, 10-02): what the eBay sales netted beside what the off-eBay
                (hand-marked) sales brought in, with the total of the two on the label row. */}
            <div className="flex min-h-6 items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.15em] text-zinc-500">Earned</p>
              {/* The sale count rides here; the caption lines under both columns are gone (Chris, 10-02). */}
              <p className="text-xs text-zinc-400">
                {stats.sold.length > 0 && (
                  <>
                    {stats.sold.length} sale{stats.sold.length === 1 ? "" : "s"}
                    {stats.avgDays !== null && <span className="hidden sm:inline"> · ~{Math.max(1, Math.round(stats.avgDays))} days to sell</span>}
                    {" · "}
                  </>
                )}
                Total{" "}
                <span className="font-display text-base font-semibold tabular-nums text-emerald-400">{formatMoney(stats.net)}</span>
              </p>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-zinc-400">On eBay</p>
                <p className="font-display text-2xl font-semibold tracking-tight text-emerald-400 sm:text-3xl">
                  <Price usd={stats.net - stats.handEarned} usdClassName="mt-1 text-xs font-normal tracking-normal text-zinc-500" />
                </p>
                <p className="text-[11px] leading-snug text-zinc-500">After Fees and Postage</p>
              </div>
              <div className="min-w-0 border-l border-edge/60 pl-3">
                <p className="text-[11px] font-medium text-zinc-400">Off eBay</p>
                <p className="font-display text-2xl font-semibold tracking-tight text-emerald-300/90 sm:text-3xl">
                  <Price usd={stats.handEarned} usdClassName="mt-1 text-xs font-normal tracking-normal text-zinc-500" />
                </p>
                <p className="text-[11px] leading-snug text-zinc-500">No Fees, No Postage</p>
              </div>
            </div>
            {stats.sold.length > 0 ? (
              <Breakdown
                rows={[
                  // With a hand-marked sale in the pile, the sales split by where they sold (those carry no fee or postage).
                  ...(stats.handCount > 0
                    ? ([
                        [`Sold on eBay · ${stats.soldCopies - stats.handCount}`, stats.earned - stats.handEarned],
                        [`Sold off eBay · ${stats.handCount}`, stats.handEarned],
                      ] as [string, number][])
                    : ([["Sold for", stats.earned]] as [string, number][])),
                  [`eBay fees${stats.feesExact ? "" : " (est.)"}`, -(stats.earned - stats.net - stats.postedCopies * POSTAGE_USD)],
                  [`Postage · ${stats.postedCopies} × ${formatMoney(POSTAGE_USD)}`, -(stats.postedCopies * POSTAGE_USD)],
                  ...(stats.costKnown > 0 ? ([[`What you paid · ${stats.costKnown} of ${stats.soldCopies}`, -stats.cost]] as [string, number][]) : []),
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
            {stats.sold.length > 0 && (
              <div className="mt-2.5 flex items-baseline justify-between gap-3 border-t border-edge/60 pt-2.5 text-sm">
                <span className="text-zinc-300">
                  Profit
                  {stats.costKnown < stats.soldCopies && (
                    <span className="ml-1 text-xs text-zinc-500">({stats.soldCopies - stats.costKnown} sale{stats.soldCopies - stats.costKnown === 1 ? "" : "s"} with no purchase price)</span>
                  )}
                </span>
                <span className={`shrink-0 font-display font-semibold tabular-nums ${stats.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {stats.profit < 0 ? "−" : ""}{formatMoney(Math.abs(stats.profit))}
                </span>
              </div>
            )}
            <Link
              href="/app/collection/report"
              className="mt-2 inline-block text-xs font-medium text-brand-300 underline-offset-4 transition hover:text-brand-200 hover:underline"
            >
              Sales Report for Taxes →
            </Link>
          </div>
        </div>
        {/* The pile's value day by day, from our own price series (Chris,
            09-10: "a graph of their listing value changing over time"). */}
        <InventoryValueChart game={gameView} version={gameCards.length} status={filter} category={category} />
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-edge/60 px-5 py-3 text-sm">
          <span className="text-zinc-400">
            <span className="font-display text-base font-semibold text-white">{stats.drafts.length}</span> not listed
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
        </div>
      </section>

      {/* Toolbar (Chris, 09-04: the stacked rows were "an amazing mess"):
          ONE panel — search + view + sort; status filter (+ Offer to
          watchers); category chips. CSV export removed (Chris).
          Phone makeover 10-02 (Chris: search read "Search na", the view
          switch was two bare icons, the status row ran off the edge): search
          gets its own full row, the view switch carries words and shares a
          row with sort, the six statuses sit in a 3×2 block with nothing
          hidden. One row from sm up, as before. No mask fades: iOS. */}
      <div className="overflow-hidden rounded-2xl border border-edge bg-surface-1">
        {/* Folded on every visit until it is tapped (Chris, 10-02). Folded,
            the line names whatever is narrowing the list, so a filter left
            on never hides cards without saying so. */}
        <button
          type="button"
          onClick={() => setToolsOpen((open) => !open)}
          aria-expanded={toolsOpen}
          aria-controls="inventory-tools"
          className={`flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left transition hover:bg-white/[0.03] ${toolsOpen ? "border-b border-edge/60" : ""}`}
        >
          <span className="flex min-w-0 items-center gap-2 text-xs text-zinc-400">
            <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <circle cx="9" cy="9" r="5.5" />
              <path d="M13.5 13.5 17 17" strokeLinecap="round" />
            </svg>
            {!toolsOpen && narrowedBy ? (
              <span className="truncate font-medium text-brand-200">{narrowedBy}</span>
            ) : (
              <span className={toolsOpen ? "uppercase tracking-[0.15em] text-zinc-500" : ""}>Search, Sort &amp; Filter</span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-brand-300">
            {toolsOpen ? "Hide" : "Show"}
            <svg viewBox="0 0 20 20" className={`h-4 w-4 transition-transform ${toolsOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 8l5 5 5-5" />
            </svg>
          </span>
        </button>
        <div id="inventory-tools" className={toolsOpen ? "p-2 sm:p-3" : "hidden"}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full min-w-0 sm:w-auto sm:flex-1">
            <svg viewBox="0 0 20 20" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <circle cx="9" cy="9" r="5.5" />
              <path d="M13.5 13.5 17 17" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              aria-label="Filter cards by name, set or number"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="h-10 w-full rounded-full border border-edge bg-black/25 pl-9 pr-3 text-base text-white placeholder:text-zinc-600 focus:border-brand-400 focus:outline-none sm:h-9 sm:text-sm"
            />
          </div>
          {/* Slide tab (Chris, 09-04: "Switch View — Image or Text"): icon
              and word on every screen (10-02: bare icons were not obvious). */}
          <div
            role="tablist"
            aria-label="Switch view"
            className="relative grid h-10 min-w-0 flex-1 grid-cols-2 rounded-full border border-edge bg-black/25 p-1 sm:h-9 sm:w-[168px] sm:flex-none"
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
                aria-label={v === "grid" ? "Images view" : "List view"}
                onClick={() => chooseView(v)}
                className={`relative z-10 flex items-center justify-center gap-1.5 rounded-full text-sm font-semibold transition-colors sm:text-xs ${
                  view === v ? "text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {v === "grid" ? (
                  <svg viewBox="0 0 20 20" className="h-4 w-4 sm:h-3.5 sm:w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                    <rect x="3" y="3" width="6" height="6" rx="1.2" />
                    <rect x="11" y="3" width="6" height="6" rx="1.2" />
                    <rect x="3" y="11" width="6" height="6" rx="1.2" />
                    <rect x="11" y="11" width="6" height="6" rx="1.2" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 20 20" className="h-4 w-4 sm:h-3.5 sm:w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                    <path d="M4 5.5h12M4 10h12M4 14.5h12" />
                  </svg>
                )}
                <span>{v === "grid" ? "Images" : "List"}</span>
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort cards"
            className="h-10 w-[38%] shrink-0 rounded-full border border-edge bg-black/25 pl-3 pr-2 text-sm text-zinc-300 focus:border-brand-400 focus:outline-none sm:h-9 sm:w-auto"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="grid grid-cols-3 gap-1 rounded-2xl bg-black/25 p-1 sm:flex sm:w-max sm:items-center sm:rounded-full">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`whitespace-nowrap rounded-full px-2 py-2 text-sm font-medium transition sm:px-3.5 sm:py-1.5 ${
                  filter === f.value ? "bg-brand-500 text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {f.label}
              </button>
            ))}
            </div>
          </div>
          {cards.some((c) => c.status === "listed" && c.ebayListingId) && (
            <button
              type="button"
              onClick={() => (offerPanel ? setOfferPanel(false) : void openOfferPanel())}
              className={`shrink-0 rounded-full border px-3 py-2 text-xs font-medium transition sm:py-1.5 ${
                offerPanel ? "border-brand-400 bg-brand-500/15 text-white" : "border-edge text-zinc-300 hover:border-edge-strong hover:text-white"
              }`}
            >
              Offer to watchers
            </button>
          )}
        </div>

        {/* Category chips (Chris, 09-04); with none yet, just the way to add
            one (09-08). */}
        {(
          <div className="-mx-2 mt-2 overflow-x-auto border-t border-edge px-2 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-3 sm:px-3">
            <div className="flex w-max items-center gap-1.5">
              <svg viewBox="0 0 20 20" className="mr-0.5 h-4 w-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
                <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h3.4l1.6 1.6h6A1.5 1.5 0 0 1 17 8.1v6.4a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5v-8Z" />
              </svg>
              {(categories.length > 0
                ? [
                    { value: "all", label: "All" },
                    ...categories.map((c) => ({ value: c, label: c })),
                    { value: "none", label: "Uncategorized" },
                  ]
                : []
              ).map((c) => {
                const n =
                  c.value === "all"
                    ? gameCards.length
                    : c.value === "none"
                      ? gameCards.filter((x) => x.category === null).length
                      : gameCards.filter((x) => x.category === c.value).length;
                return (
                  <button
                    key={c.value}
                    onClick={() => {
                      setCategory(c.value);
                      setSelected(new Set());
                    }}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                      category === c.value
                        ? "border-brand-400 bg-brand-500/15 text-white"
                        : "border-edge text-zinc-400 hover:border-edge-strong hover:text-zinc-200"
                    }`}
                  >
                    {c.label}
                    <span className={category === c.value ? "text-brand-200" : "text-zinc-600"}>{n}</span>
                  </button>
                );
              })}
              {/* Category management (Chris, 09-08): add / rename / merge / delete. */}
              <button
                type="button"
                onClick={() => setManageFolders(true)}
                title="Manage categories — add, rename, merge or delete"
                aria-label="Manage categories"
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-edge text-zinc-400 transition hover:border-edge-strong hover:text-zinc-200 ${
                  categories.length > 0 ? "ml-1 h-8 w-8 justify-center" : "px-3 py-1 text-xs font-medium"
                }`}
              >
                {categories.length > 0 ? (
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M13.5 3.5 16.5 6.5 7 16H4v-3z" />
                  </svg>
                ) : (
                  "+ New category"
                )}
              </button>
            </div>
          </div>
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
                <Link
                  href="/help/offers"
                  className="text-zinc-400 underline underline-offset-2 transition hover:text-zinc-200"
                >
                  How Offers Work
                </Link>
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
                                {card.setName} · {formatMoney(card.price)} →{" "}
                                <span className="text-emerald-400">
                                  {formatMoney(card.price * (1 - pct / 100))}
                                </span>
                              </p>
                            </div>
                            {card.watcherOfferAt ? (
                              <span className="text-xs text-zinc-500">
                                Offer sent {formatDate(card.watcherOfferAt)}
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
            <span className="text-xs text-zinc-600">· {visible.length} shown</span>
          </label>
          {selected.size > 0 && (() => {
            const selCards = cards.filter((c) => selected.has(c.id));
            const ready = selCards.filter((c) => c.status === "ready");
            const listed = selCards.filter(isLive);
            // Sold rows are the record: neither reverted nor deleted (Chris, 09-08).
            const revertable = selCards.filter((c) => c.status === "listed");
            const deletable = selCards.filter((c) => !isLive(c) && c.status !== "sold");
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
                <button onClick={() => setMoveSheet(true)} className={bulkBtn}>
                  Move to category ({selCards.length})
                </button>
                {revertable.length > 0 && (
                  <button
                    onClick={() =>
                      void applyToAll(
                        revertable,
                        () => ({ status: "ready" as const, listedAt: null, soldPrice: null, soldAt: null }),
                        `${revertable.length} back to Not Listed`,
                      )
                    }
                    className={bulkBtn}
                  >
                    Back to Not Listed ({revertable.length})
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
          <div className="text-3xl">{filter === "sealed" ? "📦" : "🃏"}</div>
          <p className="text-sm font-medium text-white">
            {cards.length === 0 ? "No cards yet" : filter === "sealed" ? "No sealed products yet" : "Nothing matches"}
          </p>
          <p className="max-w-xs text-xs text-zinc-500">
            {cards.length === 0
              ? "Scan a card and it will show up here, tracked from scan to sold."
              : filter === "sealed"
                ? "Booster boxes, ETBs and tins land here. Add one from the scanner with Add Sealed Product."
                : "Try a different filter or search."}
          </p>
          {cards.length === 0 && (
            <Link
              href="/app"
              className="mt-2 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400"
            >
              Scan Your First Card
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
            const resumeHref = `/app?resume=${card.id}&rn=${encodeURIComponent(card.cardName)}&rnum=${encodeURIComponent(card.cardNumber || "")}&rg=${parseGame(card.game)}&ri=${encodeURIComponent(card.imageUrl || "")}${card.photoAt ? `&rp=${card.photoAt}` : ""}`;
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
                      ? formatMoney(card.soldByHand ? card.soldPrice : netAfterFees(card.soldPrice, card.soldFees))
                      : headlineOf(card)}
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
                      art was tappable). Right edge, above the name/price sticker; brightens on hover, and the button is the hit area. */}
                  <span className="pointer-events-none absolute bottom-16 right-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-zinc-100 shadow backdrop-blur transition group-hover:bg-brand-500/90 group-hover:text-white">
                    {live ? "View listing" : "View card"}
                    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h7v7M13 3 7 9" /></svg>
                  </span>
                </button>

                {/* Status, top-left, on the art. */}
                <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1.5">
                  {live ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-emerald-300 backdrop-blur">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                      </span>
                      Live
                    </span>
                  ) : ended ? (
                    <span className="rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-amber-300 backdrop-blur">Auction ended</span>
                  ) : draft && !card.verifiedAt ? (
                    <span className="rounded-full bg-amber-400/90 px-2.5 py-1 text-xs font-semibold text-black shadow">Verify match</span>
                  ) : draft ? (
                    <span className="rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-emerald-300 backdrop-blur">Active</span>
                  ) : null}
                  {(card.firstEdition || card.setName.endsWith(" (1st Edition)")) && (
                    <span className="rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-brand-300 backdrop-blur">1st Edition</span>
                  )}
                  {card.matchDoubt && (
                    <span className="rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-amber-300/90 backdrop-blur" title={card.matchDoubt}>
                      ⚠ check
                    </span>
                  )}
                  {(card.quantity || 1) > 1 && (
                    <span className="rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-zinc-200 backdrop-blur">×{card.quantity}</span>
                  )}
                </div>

                {/* Select + Delete, top-right: hover on a mouse, always on touch. */}
                <div
                  className={`absolute right-2 top-2 flex items-center gap-1.5 transition [@media(hover:hover)]:group-hover:opacity-100 ${
                    isSelected || selected.size > 0 ? "" : "[@media(hover:hover)]:opacity-0"
                  }`}
                >
                  {!live && !sold && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onClick={(e) => toggleSelected(card.id, e.shiftKey)}
                      onChange={() => {}}
                      aria-label={`Select ${card.cardName}`}
                      className="h-5 w-5 cursor-pointer rounded border-zinc-500 bg-black/60 accent-brand-500"
                    />
                  )}
                  {/* Sold rows are the record — no delete (Chris, 09-08). */}
                  {(card.status !== "listed" || ended) && !sold && (
                    <button
                      onClick={() => remove(card)}
                      aria-label={`Delete ${card.cardName}`}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-zinc-300 backdrop-blur transition hover:bg-black/90 hover:text-white"
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
                      ? `sold ${formatMoney(card.soldPrice)} · net`
                      : live
                        ? "Awaiting sale"
                        : ended
                          ? formatDate(card.ebayEndedAt!)
                          : card.cardNumber
                            ? `#${card.cardNumber}`
                            : ""}
                  </span>
                  {draft && card.kind !== "sealed" && !card.verifiedAt ? (
                    // Verifying happens in the card sheet (Chris, 10-01).
                    <button
                      type="button"
                      onClick={() => void openDetail(card)}
                      className="shrink-0 rounded-full bg-amber-400/15 px-2.5 py-1 text-[11px] font-semibold text-amber-300 transition hover:bg-amber-400/25"
                    >
                      Verify
                    </button>
                  ) : draft && card.kind !== "sealed" ? (
                    <Link
                      href={resumeHref}
                      className="shrink-0 rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 transition hover:bg-white/10"
                    >
                      Build Listing
                    </Link>
                  ) : live ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      {nudges[card.id] && (
                        <button
                          onClick={() => void applyReprice(card, nudges[card.id])}
                          disabled={repricing === card.id}
                          title={`Suggested price is ${formatMoney(nudges[card.id].target)} — reprice here and on eBay`}
                          className="rounded-full bg-amber-400/15 px-2 py-1 text-[11px] font-semibold text-amber-300 transition hover:bg-amber-400/25 disabled:opacity-50"
                        >
                          {nudges[card.id].drift > 0 ? "↑" : "↓"} {formatMoney(nudges[card.id].target)}
                        </button>
                      )}
                      <button
                        onClick={() => void endListing(card)}
                        disabled={ending === card.id}
                        className="rounded-full bg-white/5 px-3 py-1.5 text-[11px] font-medium text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
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
            {visible.map((card) => {
              // Text row makeover (Chris, 09-07: "the inventory page on mobile
              // is an absolute mess"). One shape everywhere: art + name block
              // with the price pinned top-right, then ONE action row — the
              // primary button stretches on a phone, quiet secondaries sit
              // beside it. From sm up the same pieces sit on one line.
              const liveRow = isLive(card);
              const ended = card.status === "listed" && Boolean(card.ebayEndedAt);
              const sold = card.status === "sold";
              const draft = card.status === "ready";
              // sm+: a fixed three-slot grid (primary · View on eBay · Delete) so every
              // row lines up whatever it shows (Chris, 09-08: "I really hate these columns").
              const primaryBtn = "inline-flex h-10 flex-1 items-center justify-center whitespace-nowrap rounded-full px-4 text-sm font-semibold transition sm:h-8 sm:w-full sm:flex-none sm:px-2 sm:text-xs sm:row-start-1";
              const slotBase = "inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition disabled:opacity-50 sm:h-8 sm:w-full sm:px-2 sm:text-xs sm:row-start-1";
              // Real actions carry a tint so they read as buttons next to the
              // "Not Listed" ghost that fills slot two on desktop (Chris, 09-08).
              const viewBtn = `${slotBase} border-sky-400/30 text-sky-300 hover:border-sky-400/60 hover:bg-sky-400/10`;
              // Delete is a small X (Chris, 10-01) so Mark as Sold fits beside it.
              const deleteBtn = "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red-400/25 text-red-300/80 transition hover:border-red-400/60 hover:bg-red-400/10 hover:text-red-200 sm:h-8 sm:w-8 sm:row-start-1";
              const soldBtn = `${slotBase} border-emerald-400/30 text-emerald-300 hover:border-emerald-400/60 hover:bg-emerald-400/10`;
              // Desktop only: "hidden" beside slotBase's "inline-flex" lost the tie and the ghost showed on phones.
              const ghostSlot = `${slotBase.replace("inline-flex", "hidden sm:inline-flex")} border-dashed border-edge/60 text-zinc-600`;
              // The row chip compares against the SCANNED price, so it persists
              // across loads (Chris, 09-08: it vanished once the price settled).
              // Market against market since 10-02 (the row leads with the Market price): the market on the day
              // the card was added vs today's. The scan-time ASKING price would fake a move on every cheap card.
              const scannedAt = livePrices[card.id]?.marketThen ?? null;
              const marketNow = marketOf(card);
              // A flagged market moves nothing: no "was $X, now $Y" chip built on it (the price guard).
              const rowFlag = !sold && !card.priceLocked && livePrices[card.id]?.flag != null;
              const moved = !sold && !rowFlag && marketNow != null && scannedAt != null && scannedAt > 0 && Math.abs(scannedAt - marketNow) >= 0.01;
              return (
              <li key={card.id} className="px-3 py-3 sm:flex sm:items-center sm:gap-3 sm:px-4">
                <div className="flex items-start gap-3 sm:min-w-0 sm:flex-1 sm:items-center">
                  <input
                    type="checkbox"
                    checked={selected.has(card.id)}
                    // onClick, not onChange: the change event has no shiftKey.
                    onClick={(e) => toggleSelected(card.id, e.shiftKey)}
                    onChange={() => {}}
                    aria-label={`Select ${card.cardName}`}
                    className="mt-1 h-5 w-5 shrink-0 accent-brand-500 sm:mt-0 sm:h-4 sm:w-4"
                  />
                  <CardImage
                    // The seller's own scan photo when one is stored; catalog art otherwise.
                    src={card.photoAt ? apiPath(`/api/card-image/${card.id}?v=${card.photoAt}`) : card.imageUrl}
                    alt={card.cardName}
                    className="h-[4.5rem] w-[3.25rem] shrink-0 rounded-md sm:h-16 sm:w-12"
                  />

                  <div
                    // Tappable (QA leftover): the row's name block opens the card,
                    // same as the binder art. Buttons inside the row stay their own.
                    role="button"
                    tabIndex={0}
                    onClick={() => void openDetail(card)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void openDetail(card);
                      }
                    }}
                    className="min-w-0 flex-1 cursor-pointer rounded-lg outline-none transition hover:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-brand-400"
                  >
                    <p className="line-clamp-2 text-[15px] font-semibold leading-tight text-white [overflow-wrap:anywhere] sm:text-sm">
                      {card.cardName}
                      {(card.quantity || 1) > 1 && (
                        <span className="ml-1.5 rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">
                          ×{card.quantity}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug text-zinc-500 sm:truncate">
                      {card.setName}
                      {card.cardNumber && ` · ${card.cardNumber}`} · {card.condition}
                    </p>
                    {/* Meta line: the state chip leads, then the dates. An
                        unverified draft has no chip — the amber Verify Match
                        button IS its state (Chris, 09-03). */}
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-600">
                      {ended ? (
                        <span
                          className="whitespace-nowrap rounded-full bg-amber-400/10 px-2 py-0.5 font-medium text-amber-300"
                          title={`This listing ended on eBay without a sale (${formatDate(card.ebayEndedAt!)}). Relist it, or delete the card.`}
                        >
                          Auction ended
                        </span>
                      ) : liveRow ? (
                        <span
                          className="whitespace-nowrap rounded-full bg-sky-400/10 px-2 py-0.5 font-medium text-sky-300"
                          title="Flips to Sold on its own once eBay reports the order"
                        >
                          Awaiting sale
                        </span>
                      ) : sold ? (
                        <span className="whitespace-nowrap rounded-full bg-emerald-400/10 px-2 py-0.5 font-medium text-emerald-300">Sold</span>
                      ) : card.verifiedAt ? (
                        <span
                          className="whitespace-nowrap rounded-full bg-emerald-400/10 px-2 py-0.5 font-medium text-emerald-400"
                          title="Match verified — ready to publish"
                        >
                          Active
                        </span>
                      ) : null}
                      {(card.firstEdition || card.setName.endsWith(" (1st Edition)")) && (
                        <span
                          className="whitespace-nowrap rounded-full border border-brand-400/40 bg-brand-500/10 px-2 py-0.5 font-semibold text-brand-300"
                          title="1st Edition stamp — priced and listed as its own printing"
                        >
                          1st Edition
                        </span>
                      )}
                      <span className="whitespace-nowrap">
                        Added {formatDate(card.createdAt)}
                        {card.status === "listed" && card.listedAt && ` · listed ${formatDate(card.listedAt)}`}
                        {sold && card.soldAt && ` · sold ${formatDate(card.soldAt)}`}
                        {!card.ebayListingUrl && card.ebayOfferId && " · draft on eBay"}
                      </span>
                    </p>
                    {card.matchDoubt && (
                      <p
                        className="mt-1 truncate text-[11px] text-amber-300/90"
                        title="The scan wasn't sure about this one — worth a close look before verifying"
                      >
                        ⚠ {card.matchDoubt}
                      </p>
                    )}
                  </div>

                  {/* The price is what a seller scans the list FOR (Chris,
                      08-31: "make the prices bigger"). Pinned top-right so
                      it lines up with the name on every row. A sold row
                      leads with NET; gross is its caption. */}
                  <div className="flex w-24 shrink-0 flex-col items-end text-right sm:w-32">
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
                            className="w-20 rounded-md border border-edge bg-black/40 py-1 pl-4 pr-1 text-right text-base text-white outline-none focus:border-brand-400 sm:text-sm"
                          />
                        </span>
                        <button
                          type="submit"
                          className="rounded-full bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
                        >
                          ✓
                        </button>
                      </form>
                    ) : sold && card.soldPrice != null ? (
                      <>
                        {/* Sold (Chris, 09-08): the SOLD price leads with a
                            sold marker; what the seller keeps is the caption.
                            The recorded sale price stays correctable in place —
                            it drives the Earned tiles. */}
                        <span className="mb-0.5 inline-flex items-center gap-1 rounded-full bg-sky-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-300">
                          Sold
                        </span>
                        <p className="font-display text-lg font-bold tabular-nums tracking-tight text-emerald-400">
                          {formatMoney(card.soldPrice)}
                        </p>
                        <button
                          onClick={() => setSoldForm({ id: card.id, value: card.soldPrice!.toFixed(2) })}
                          title={`${card.soldByHand ? "Marked sold by hand: no eBay fee or postage" : card.soldFees != null ? `eBay fees ${formatMoney(card.soldFees)} (actual)` : "eBay fees estimated"} — tap to correct the sale price`}
                          className="text-[11px] font-medium text-zinc-400 underline decoration-zinc-700 underline-offset-2 transition hover:text-zinc-200"
                        >
                          {card.soldByHand ? "no fees · edit" : `you keep ${formatMoney(netAfterFees(card.soldPrice, card.soldFees))}`}
                        </button>
                      </>
                    ) : (
                      <>
                        {/* Price column makeover (Chris, 09-08). Live listings:
                            the price IS the Change price control — tap it (the
                            pencil says so) and the sheet changes it here AND on
                            eBay (09-04). Drafts are priced in the editor. */}
                        {/* The Market price leads every unsold row (Chris, 10-02). */}
                        <p className="font-display text-lg font-bold tabular-nums tracking-tight text-white">
                          {headlineOf(card)}
                        </p>
                        {/* A live listing's own price sits under it and IS the
                            Change price control: the sheet changes it here AND
                            on eBay (09-04). */}
                        {liveRow &&
                          (card.ebayOfferId && repricing !== card.id ? (
                            <button
                              onClick={() => setPriceSheet(card.id)}
                              title="Change price — here and on the live eBay listing"
                              aria-label={`Change price, currently ${formatMoney(card.price)} on eBay`}
                              className="group -mr-1.5 inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-zinc-300 transition hover:bg-white/5"
                            >
                              On eBay {formatMoney(card.price)}
                              <svg viewBox="0 0 20 20" className="h-3 w-3 text-zinc-500 transition group-hover:text-brand-300" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <path d="M13.5 3.5 16.5 6.5 7 16H4v-3z" />
                              </svg>
                            </button>
                          ) : (
                            <p className="whitespace-nowrap text-[11px] font-medium tabular-nums text-zinc-400">
                              {repricing === card.id ? "Saving…" : `On eBay ${formatMoney(card.price)}`}
                            </p>
                          ))}
                        {/* The market's move since this card was added, as a pill: direction, %, and the market then. */}
                        {moved && (() => {
                          const up = marketNow! > scannedAt!;
                          const pct = (Math.abs(marketNow! - scannedAt!) / scannedAt!) * 100;
                          return (
                            <span
                              title={`The market was ${formatMoney(scannedAt!)} when this was added — it has moved ${up ? "up" : "down"} ${formatMoney(Math.abs(marketNow! - scannedAt!))}`}
                              className={`mt-0.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                                up ? "bg-emerald-400/10 text-emerald-300" : "bg-rose-400/10 text-rose-300"
                              }`}
                            >
                              <span aria-hidden>{up ? "▲" : "▼"}</span>
                              {pct >= 100 ? Math.round(pct) : pct.toFixed(pct >= 10 ? 0 : 1)}%
                              <span className="font-normal opacity-70">was {formatMoney(scannedAt!)}</span>
                            </span>
                          );
                        })()}
                        {rowFlag && !liveRow && !ended && <p className="mt-0.5 max-w-[15rem] text-[11px] leading-snug"><PriceFlagText /></p>}
                        {card.status === "listed" && nudges[card.id] && (
                          <button
                            onClick={() => void applyReprice(card, nudges[card.id])}
                            disabled={repricing === card.id}
                            title={`Suggested price is ${formatMoney(nudges[card.id].target)}, ${Math.round(Math.abs(nudges[card.id].drift) * 100)}% ${nudges[card.id].drift > 0 ? "above" : "below"} your price — one tap updates the price here and on the live eBay listing.`}
                            className="mt-1 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 transition hover:border-amber-400/50 hover:bg-amber-400/20 disabled:opacity-50"
                          >
                            {repricing === card.id ? (
                              "Repricing…"
                            ) : (
                              <>
                                <span aria-hidden>{nudges[card.id].drift > 0 ? "↑" : "↓"}</span>
                                Reprice to {formatMoney(nudges[card.id].target)}
                              </>
                            )}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* ONE action row. Phone: primary stretches, quiet buttons
                    beside it, indented under the name block. sm+: tucked
                    right on the same visual line as the price. */}
                <div className="mt-2.5 flex items-center gap-2 pl-8 sm:mt-0 sm:grid sm:shrink-0 sm:grid-cols-[7rem_7rem_6.5rem_2rem] sm:gap-1.5 sm:pl-0">
                  {draft && card.kind !== "sealed" && !card.verifiedAt && (
                    // Verify Match opens the big card sheet and the verifying
                    // happens in there, photo beside the match (Chris, 10-01).
                    <button
                      type="button"
                      onClick={() => void openDetail(card)}
                      className={`${primaryBtn} sm:col-start-1 bg-amber-400/15 text-amber-300 hover:bg-amber-400/25`}
                    >
                      Verify Match
                    </button>
                  )}
                  {draft && card.kind !== "sealed" && card.verifiedAt && (
                    <Link
                      // Card identity rides along so the scanner can start the
                      // catalog search in parallel with the ledger fetch —
                      // sequential round trips made this feel stuck (09-02).
                      href={resumeHrefFor(card)}
                      className={`${primaryBtn} sm:col-start-1 bg-brand-500/15 text-brand-300 hover:bg-brand-500/25`}
                    >
                      Build Listing
                    </Link>
                  )}
                  {/* Row states: live → End Auction (flips to Sold on its own
                      from eBay orders); draft / ended → Mark as Sold (a sale
                      made off eBay, Chris 10-01) + the X delete; sold → the
                      record. */}
                  {liveRow && (
                    <button
                      onClick={() => void endListing(card)}
                      disabled={ending === card.id}
                      // Amber, in the last slot (Chris, 09-08): the stop action sits where
                      // Delete sits on other rows, and reads as a warning, not a grey nothing.
                      className={`${slotBase} order-last sm:col-start-3 sm:col-span-2 border-amber-400/35 text-amber-300 hover:border-amber-400/70 hover:bg-amber-400/10`}
                    >
                      {ending === card.id ? "Ending…" : "End Auction"}
                    </button>
                  )}
                  {ended && (
                    <button onClick={() => void relist(card)} className={`${primaryBtn} sm:col-start-1 bg-brand-500/15 text-brand-300 hover:bg-brand-500/25`}>
                      Relist
                    </button>
                  )}
                  {card.ebayListingUrl ? (
                    <a
                      href={card.ebayListingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${viewBtn} sm:col-start-2 ${liveRow ? "flex-1 sm:flex-none" : ""}`}
                    >
                      View on eBay
                    </a>
                  ) : (
                    <span aria-hidden className={`${ghostSlot} sm:col-start-2`}>
                      Not Listed
                    </span>
                  )}
                  {/* Live rows have no Delete; slot three is a green Live badge
                      instead (Chris, 09-08: "a green Live button somewhere obvious"). */}
                  {liveRow && (
                    <span
                      title="Live on eBay — flips to Sold on its own once eBay reports the order"
                      className={`${slotBase} sm:col-start-1 border-emerald-400/40 bg-emerald-400/15 font-semibold text-emerald-300`}
                    >
                      <span className="relative mr-1.5 flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      </span>
                      Live
                    </span>
                  )}
                  {/* Sold rows are the record: a Sold badge leads, no Delete,
                      no Relist — viewable for good (Chris, 09-08). */}
                  {sold && (
                    <>
                      <span className={`${slotBase} sm:col-start-1 border-sky-400/40 bg-sky-400/15 font-semibold text-sky-300`}>
                        Sold{card.soldAt ? ` ${formatDate(card.soldAt)}` : ""}
                      </span>
                      <span aria-hidden className={`${ghostSlot} sm:col-start-3 sm:col-span-2`}>
                        Kept on record
                      </span>
                    </>
                  )}
                  {(card.status !== "listed" || ended) && !sold && (
                    <>
                      <button
                        type="button"
                        onClick={() => setSoldSheet(card.id)}
                        className={`${soldBtn} sm:col-start-3 ${draft && card.kind === "sealed" ? "flex-1 sm:flex-none" : ""}`}
                      >
                        Mark as Sold
                      </button>
                      <button
                        onClick={() => remove(card)}
                        aria-label={`Delete ${card.cardName}`}
                        title="Delete"
                        className={`${deleteBtn} sm:col-start-4`}
                      >
                        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                          <path d="M5 5l10 10M15 5l-10 10" strokeLinecap="round" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </li>
              );
            })}
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
            centering={card.game !== "mtg" && card.kind !== "sealed"}
            sealed={card.kind === "sealed"}
            aside={renderDetailAside(card)}
            onClose={() => setDetail(null)}
          />
        );
      })()}

      {manageFolders && (
        <CategoryManager
          categories={categories.map((name) => ({ name, count: cards.filter((c) => c.category === name).length }))}
          busy={folderBusy}
          onClose={() => setManageFolders(false)}
          onAdd={addFolder}
          onRename={renameFolder}
          onDelete={deleteFolder}
        />
      )}
      {categoryTarget && (
        <CategorySheet
          title={`Category for ${categoryTarget.cardName}`}
          hint="Pick a category, or type a new one. Choose No category to clear it."
          categories={categories}
          current={categoryTarget.category}
          confirmLabel="Move card"
          busy={moving}
          onClose={() => setCategoryTarget(null)}
          onPick={async (next) => {
            const target = cards.find((c) => c.id === categoryTarget.id) ?? categoryTarget;
            if (target.category !== next) {
              setMoving(true);
              await applyPatch(target, { category: next });
              setMoving(false);
              toast(next ? `${target.cardName} → ${next}` : `${target.cardName} uncategorized`);
            }
            setCategoryTarget(null);
          }}
        />
      )}
      {moveSheet && (
        <CategorySheet
          title={`Move ${selected.size} card${selected.size === 1 ? "" : "s"} to…`}
          hint="Pick a category, or type a new one. Choose No category to clear it."
          categories={categories}
          current={(() => {
            const first = cards.find((c) => selected.has(c.id));
            return first?.category ?? null;
          })()}
          confirmLabel="Move"
          busy={moving}
          onClose={() => setMoveSheet(false)}
          onPick={async (next) => {
            const targets = cards.filter((c) => selected.has(c.id) && c.category !== next);
            setMoving(true);
            await Promise.all(targets.map((c) => applyPatch(c, { category: next })));
            setMoving(false);
            setMoveSheet(false);
            setSelected(new Set());
            toast(next ? `${targets.length} moved to ${next}` : `${targets.length} uncategorized`);
          }}
        />
      )}
      {soldSheet && (() => {
        const card = cards.find((c) => c.id === soldSheet);
        if (!card) return null;
        return (
          <MarkSoldSheet
            card={card}
            onClose={() => setSoldSheet(null)}
            onSubmit={(price) => {
              setSoldSheet(null);
              confirmSold(card, price.toFixed(2));
            }}
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
