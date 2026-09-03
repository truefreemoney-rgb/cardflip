"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import CardImage from "@/components/CardImage";
import PageSkeleton from "@/components/PageSkeleton";
import Spinner from "@/components/Spinner";
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
import { fetchWatcherEligible, saveAutoOffer, sendWatcherOffer, syncEbaySales } from "@/lib/client/ebayApi";
import { confirmAction } from "@/components/ConfirmDialog";
import { apiPath } from "@/lib/client/basePath";
import { estimatedEbayFees, netAfterFees } from "@/lib/fees";
import { toast } from "@/components/Toaster";

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

// Sorts a seller actually reaches for: the money cards, what's been sitting
// live the longest, and what just sold. Applied client-side over the loaded
// ledger; "newest" matches the server's own order.
type SortKey = "newest" | "price" | "listedAge" | "soldRecent";
const SORTS: { value: SortKey; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "price", label: "Price high → low" },
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

// Outside the component so the render-purity lint can see these only run on
// click, not during render.
function listedNowPatch() {
  return { status: "listed" as const, listedAt: Date.now() };
}

function soldNowPatch(price: number) {
  return { status: "sold" as const, soldPrice: price, soldAt: Date.now() };
}

function watcherOfferNowPatch() {
  return { watcherOfferAt: Date.now() };
}

export default function CollectionPage() {
  const { user } = useSession();
  const [cards, setCards] = useState<ServerCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  // "Mark sold" asks what it actually went for (prefilled with the asking
  // price) instead of silently recording the ask — the Earned tiles are only
  // as honest as this number. Also reused to correct a sold row's price.
  const [soldForm, setSoldForm] = useState<{ id: string; value: string } | null>(null);
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
          `${ended.length} ${ended.length === 1 ? "listing" : "listings"} ended on eBay without selling — relist, or move the card back to drafts.`,
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
    setRepricing(card.id);
    setSyncError(null);
    const result = await repriceCard(card.id, nudge.market);
    setRepricing(null);
    if (!result.ok) {
      setSyncError(`Couldn't reprice ${card.cardName} — try again.`);
      toast(`Couldn't reprice ${card.cardName} — try again`, "err", {
        label: "Help",
        onClick: () => window.open("/help#reprice", "_blank", "noopener"),
      });
      return;
    }
    patchCard(card.id, { price: nudge.market });
    toast(`${card.cardName} repriced to $${nudge.market.toFixed(2)}`);
    setNudges((prev) => {
      const next = { ...prev };
      delete next[card.id];
      return next;
    });
    if (card.ebayListingUrl && !result.ebayUpdated) {
      setSyncError(
        `${card.cardName} is $${nudge.market.toFixed(2)} here now, but eBay didn't take the change${result.ebayError ? ` (${result.ebayError})` : ""} — update the live listing on eBay.`,
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

  function markListed(card: ServerCard) {
    void applyPatch(card, listedNowPatch());
    toast(`${card.cardName} marked listed`);
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

  function backToDraft(card: ServerCard) {
    void applyPatch(card, {
      status: "ready",
      listedAt: null,
      soldPrice: null,
      soldAt: null,
    });
    toast(`${card.cardName} back to drafts`);
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

  const stats = useMemo(() => {
    const drafts = cards.filter((c) => c.status === "ready");
    const listed = cards.filter((c) => c.status === "listed");
    const sold = cards.filter((c) => c.status === "sold");

    const earned = sold.reduce((sum, c) => sum + (c.soldPrice ?? 0), 0);
    const net = sold.reduce(
      (sum, c) => sum + (c.soldPrice != null ? netAfterFees(c.soldPrice, c.soldFees) : 0),
      0,
    );
    // Every sale has its real fee recorded → the fee figure drops its "≈".
    const feesExact = sold.every((c) => c.soldPrice == null || c.soldFees != null);
    const inPlay = [...drafts, ...listed].reduce((sum, c) => sum + c.price * (c.quantity || 1), 0);

    // Listed→sold gap, only over cards that carry both timestamps.
    const gaps = sold
      .filter((c) => c.listedAt && c.soldAt)
      .map((c) => (c.soldAt! - c.listedAt!) / DAY_MS);
    const avgDays =
      gaps.length > 0
        ? gaps.reduce((sum, days) => sum + days, 0) / gaps.length
        : null;

    return { drafts, listed, sold, earned, net, feesExact, inPlay, avgDays };
  }, [cards]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
    const shown = cards.filter((card) => {
      if (filter !== "all" && card.status !== filter) return false;
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
  }, [cards, filter, query, sort]);

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
            {stats.sold.length > 0 && ` · ${stats.earned.toFixed(2)} gross · ${stats.feesExact ? "" : "≈"}${(stats.earned - stats.net).toFixed(2)} eBay fees`}
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
        <div className="flex items-center gap-2">
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
            className="w-full max-w-xs rounded-full border border-edge bg-surface-1 px-4 py-2 text-base text-white placeholder:text-zinc-600 focus:border-brand-400 focus:outline-none sm:text-sm"
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
            const listed = selCards.filter((c) => c.status === "listed");
            const revertable = selCards.filter((c) => c.status !== "ready");
            const deletable = selCards.filter((c) => c.status !== "listed");
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
                {ready.length > 0 && (
                  <button
                    onClick={() => void applyToAll(ready, () => listedNowPatch(), `${ready.length} marked listed`)}
                    className={bulkBtn}
                  >
                    Mark listed ({ready.length})
                  </button>
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
      ) : (
        <div className="overflow-hidden rounded-2xl border border-edge bg-surface-1">
          <ul className="divide-y divide-white/5">
            {visible.map((card) => (
              <li
                key={card.id}
                className="flex flex-wrap items-center gap-4 px-4 py-3"
              >
                <input
                  type="checkbox"
                  checked={selected.has(card.id)}
                  onChange={() => toggleSelected(card.id)}
                  aria-label={`Select ${card.cardName}`}
                  className="h-4 w-4 shrink-0 accent-brand-500"
                />
                <CardImage
                  // The seller's own scan photo when one is stored; catalog art otherwise.
                  src={card.photoAt ? apiPath(`/api/card-image/${card.id}?v=${card.photoAt}`) : card.imageUrl}
                  alt={card.cardName}
                  className="h-16 w-12 shrink-0 rounded-md"
                />

                <div className="min-w-0 flex-1">
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

                {/* The sync stamps ebayEndedAt when the listing ended on eBay
                    without a sale; the card stays "listed" until the seller
                    decides, but the chip stops claiming it's live. */}
                {card.status === "listed" && card.ebayEndedAt ? (
                  <span
                    className="rounded-full bg-amber-400/10 px-2.5 py-1 text-xs font-medium text-amber-300"
                    title={`eBay ended this listing without a sale (noticed ${formatDate(card.ebayEndedAt)}). Relist it, or move it back to drafts.`}
                  >
                    Ended on eBay
                  </span>
                ) : (
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_CHIP[card.status]}`}
                  >
                    {STATUS_LABEL[card.status]}
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
                        ${card.price.toFixed(2)}
                      </p>
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
                      href={`/app?resume=${card.id}&rn=${encodeURIComponent(card.cardName)}&rnum=${encodeURIComponent(card.cardNumber || "")}&rg=${card.game === "mtg" ? "mtg" : "pokemon"}`}
                      className="rounded-full bg-brand-500/15 px-3 py-1.5 text-xs font-medium text-brand-300 transition hover:bg-brand-500/25"
                    >
                      Build listing
                    </Link>
                  )}
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
                        onClick={() => setSoldForm({ id: card.id, value: card.price.toFixed(2) })}
                        className="rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/25"
                      >
                        Mark sold
                      </button>
                      <button
                        onClick={() => backToDraft(card)}
                        className="rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-400 transition hover:border-edge-strong"
                      >
                        {card.ebayEndedAt ? "Back to drafts" : "Unlist"}
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
