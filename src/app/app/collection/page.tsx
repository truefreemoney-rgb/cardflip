"use client";

import { useEffect, useMemo, useState } from "react";
import CardImage from "@/components/CardImage";
import PageSkeleton from "@/components/PageSkeleton";
import { useSession } from "@/components/SessionProvider";
import {
  deleteServerCard,
  fetchServerCards,
  updateServerCard,
  type ServerCard,
} from "@/lib/client/cardsApi";
import { syncEbaySales } from "@/lib/client/ebayApi";

/**
 * Every card the seller has ever scanned, with where it is in its life:
 * draft → listed → sold. The scanner page is a per-session workbench; this is
 * the ledger that survives closing the tab.
 */

type StatusFilter = "all" | "ready" | "listed" | "sold";

const STATUS_LABEL: Record<ServerCard["status"], string> = {
  ready: "Draft",
  listed: "Listed",
  sold: "Sold",
};

const STATUS_CHIP: Record<ServerCard["status"], string> = {
  ready: "bg-zinc-400/10 text-zinc-300",
  listed: "bg-sky-400/10 text-sky-300",
  sold: "bg-emerald-400/10 text-emerald-300",
};

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ready", label: "Drafts" },
  { value: "listed", label: "Listed" },
  { value: "sold", label: "Sold" },
];

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Mirrors the estimate in lib/server/cards.ts: eBay's ~13.25% final value fee
// plus the $0.30 per-order fixed fee. An estimate until the eBay API can
// report real fees — good enough to keep "earned" honest.
const EBAY_FEE_RATE = 0.1325;
const EBAY_FLAT_FEE = 0.3;

function netAfterFees(soldPrice: number): number {
  return soldPrice - (soldPrice * EBAY_FEE_RATE + EBAY_FLAT_FEE);
}

// Outside the component so the render-purity lint can see these only run on
// click, not during render.
function listedNowPatch() {
  return { status: "listed" as const, listedAt: Date.now() };
}

function soldNowPatch(price: number) {
  return { status: "sold" as const, soldPrice: price, soldAt: Date.now() };
}

export default function CollectionPage() {
  const { user } = useSession();
  const [cards, setCards] = useState<ServerCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [syncError, setSyncError] = useState<string | null>(null);

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
      if (result.sold.length > 0) {
        setCards((prev) =>
          prev.map((card) => result.sold.find((s) => s.id === card.id) ?? card),
        );
        setSaleNote(
          `${result.sold.length} ${result.sold.length === 1 ? "card" : "cards"} marked sold from your eBay orders.`,
        );
      } else if (result.skipped === "no_scope") {
        setSaleNote(
          "Reconnect eBay (Account settings → eBay) to let CardFlip mark sold cards automatically — your current link predates that permission.",
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

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
    }
  }

  function markListed(card: ServerCard) {
    void applyPatch(card, listedNowPatch());
  }

  function markSold(card: ServerCard) {
    // The listing price is the best default for what it actually sold for;
    // a different final price can be set from the scanner's editor.
    void applyPatch(card, soldNowPatch(card.price));
  }

  function backToDraft(card: ServerCard) {
    void applyPatch(card, {
      status: "ready",
      listedAt: null,
      soldPrice: null,
      soldAt: null,
    });
  }

  async function remove(card: ServerCard) {
    // Deleting is the one action here with no undo — say so once.
    const label = card.status === "sold" ? "this sold record" : "this card";
    if (!window.confirm(`Remove ${label} (${card.cardName}) from your collection? This can't be undone.`)) return;
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
    }
  }

  const stats = useMemo(() => {
    const drafts = cards.filter((c) => c.status === "ready");
    const listed = cards.filter((c) => c.status === "listed");
    const sold = cards.filter((c) => c.status === "sold");

    const earned = sold.reduce((sum, c) => sum + (c.soldPrice ?? 0), 0);
    const net = sold.reduce(
      (sum, c) => sum + (c.soldPrice != null ? netAfterFees(c.soldPrice) : 0),
      0,
    );
    const inPlay = [...drafts, ...listed].reduce((sum, c) => sum + c.price, 0);

    // Listed→sold gap, only over cards that carry both timestamps.
    const gaps = sold
      .filter((c) => c.listedAt && c.soldAt)
      .map((c) => (c.soldAt! - c.listedAt!) / DAY_MS);
    const avgDays =
      gaps.length > 0
        ? gaps.reduce((sum, days) => sum + days, 0) / gaps.length
        : null;

    return { drafts, listed, sold, earned, net, inPlay, avgDays };
  }, [cards]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cards.filter((card) => {
      if (filter !== "all" && card.status !== filter) return false;
      if (!needle) return true;
      return (
        card.cardName.toLowerCase().includes(needle) ||
        card.setName.toLowerCase().includes(needle)
      );
    });
  }, [cards, filter, query]);

  if (!user) return <PageSkeleton />;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">My cards</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Everything you&apos;ve scanned, and where each card is on its way
          to sold.
        </p>
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-edge bg-surface-1 p-4">
          <p className="text-xs text-zinc-500">Drafts</p>
          <p className="mt-1 text-xl font-semibold text-white">
            {stats.drafts.length}
          </p>
        </div>
        <div className="rounded-2xl border border-edge bg-surface-1 p-4">
          <p className="text-xs text-zinc-500">Listed</p>
          <p className="mt-1 text-xl font-semibold text-sky-300">
            {stats.listed.length}
          </p>
        </div>
        <div className="rounded-2xl border border-edge bg-surface-1 p-4">
          <p className="text-xs text-zinc-500">In play</p>
          <p className="mt-1 text-xl font-semibold text-white">
            ${stats.inPlay.toFixed(2)}
          </p>
          <p className="text-[11px] text-zinc-600">drafts + live listings</p>
        </div>
        <div className="rounded-2xl border border-edge bg-surface-1 p-4">
          {/* The big number is the money that actually reached the seller --
              net after eBay fees, same as the admin panel leads with. Gross
              and the fee estimate drop to the detail line (Chris, 08-31:
              sellers need to see the sale the way admin does). */}
          <p className="text-xs text-zinc-500">Earned</p>
          <p className="mt-1 text-xl font-semibold text-emerald-400">
            ${stats.net.toFixed(2)}
          </p>
          <p className="text-[11px] text-zinc-600">
            {stats.sold.length} sold
            {stats.sold.length > 0 && ` · ${stats.earned.toFixed(2)} gross · ≈${(stats.earned - stats.net).toFixed(2)} eBay fees`}
            {stats.avgDays !== null &&
              ` · ~${Math.max(1, Math.round(stats.avgDays))}d to sell`}
          </p>
        </div>
      </div>

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
        <input
          type="search"
          aria-label="Filter cards by name or set"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name or set"
          className="w-full max-w-xs rounded-full border border-edge bg-surface-1 px-4 py-2 text-base text-white placeholder:text-zinc-600 focus:border-brand-400 focus:outline-none sm:text-sm"
        />
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
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
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-edge bg-surface-1">
          <ul className="divide-y divide-white/5">
            {visible.map((card) => (
              <li
                key={card.id}
                className="flex flex-wrap items-center gap-4 px-4 py-3"
              >
                <CardImage
                  src={card.imageUrl}
                  alt={card.cardName}
                  className="h-16 w-12 shrink-0 rounded-md"
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">
                    {card.cardName}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {card.setName}
                    {card.cardNumber && ` · ${card.cardNumber}`} ·{" "}
                    {card.condition}
                  </p>
                  <p className="text-[11px] text-zinc-600">
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
                  </p>
                </div>

                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_CHIP[card.status]}`}
                >
                  {STATUS_LABEL[card.status]}
                </span>

                <div className="w-24 text-right">
                  <p className="text-sm font-semibold text-white">
                    $
                    {(card.status === "sold"
                      ? (card.soldPrice ?? card.price)
                      : card.price
                    ).toFixed(2)}
                  </p>
                  {card.status === "sold" && card.soldPrice != null && (
                    <p className="text-[10px] text-zinc-600">
                      ≈${netAfterFees(card.soldPrice).toFixed(2)} net
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {card.status === "ready" && (
                    <button
                      onClick={() => markListed(card)}
                      className="rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-edge-strong hover:bg-surface-2"
                    >
                      Mark listed
                    </button>
                  )}
                  {card.status === "listed" && (
                    <>
                      <button
                        onClick={() => markSold(card)}
                        className="rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/25"
                      >
                        Mark sold
                      </button>
                      <button
                        onClick={() => backToDraft(card)}
                        className="rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-400 transition hover:border-edge-strong"
                      >
                        Unlist
                      </button>
                    </>
                  )}
                  {card.status !== "listed" && (
                    <button
                      onClick={() => remove(card)}
                      aria-label={`Delete ${card.cardName}`}
                      className="rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-500 transition hover:border-red-400/40 hover:text-red-300"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
