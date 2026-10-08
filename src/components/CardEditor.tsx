"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePriceFloor } from "@/lib/client/localMarket";
import { toast } from "@/components/Toaster";
import Spinner from "@/components/Spinner";
import { MatchHero } from "@/components/CenteringPhoto";
import ListedPanel from "@/components/ListedPanel";
import SoldPanel from "@/components/SoldPanel";
import CardImage from "@/components/CardImage";
import MissingCardReport from "@/components/MissingCardReport";
import MarketMetricsPanel from "@/components/MarketMetricsPanel";
import EbayPostActions from "@/components/EbayPostActions";
import { useSession } from "@/components/SessionProvider";
import ListingCopyFields from "@/components/ListingCopyFields";
import PriceInput from "@/components/PriceInput";
import { updateServerCard } from "@/lib/client/cardsApi";
import { fetchEbayComps } from "@/lib/client/ebayApi";
import { fetchCardById, searchCards, searchTyped } from "@/lib/cards";
import { speciesName as speciesOf } from "@/lib/speciesName";
import { displayCardNumber } from "@/lib/games";
import { addToWishlist } from "@/lib/client/wishlistApi";
import Price from "@/components/Price";
import LocalListingLine from "@/components/LocalListingLine";
import { CONDITIONS, CONDITION_MULTIPLIER, buildListing, canPriceListing, describeItemCondition, canBeFirstEdition, effectiveVariant, formatMoney, ebaySearchUrl, ebaySoldSearchUrl, isFirstEditionCard, isFirstEditionVariant, itemFirstEdition, quoteForItem, quotePrice, quickSaleEligible, withListingOverrides, floorNote, priceFlagOf, priceStaleOf } from "@/lib/listing";
import PriceFlagNote, { PriceStaleNote } from "@/components/PriceFlagNote";
import { GRADED_LOCKED, GRADING_COMPANIES, gradeLabel, gradesFor } from "@/lib/grading";
import { LOW_CONFIDENCE } from "@/lib/types";
import { foilChoices, foilLabel } from "@/lib/yugioh";
import { printingChoices, printingLabel } from "@/lib/onepiece";
import { useLastRecordedPrice } from "@/lib/client/priceHistoryData";
import { saveCondition, saveStrategy } from "@/lib/client/scanPrefs";
import { ENVELOPE_MAX_USD, envelopeAllowed, formatMoneyPostage } from "@/lib/fees";
import { ENVELOPE_OVER_CAP, SHIP_OPTIONS } from "@/lib/shipping";
import ShippingHelpSheet from "@/components/ShippingHelpSheet";
import type {
  Condition,
  WearLevel,
  GradedInfo,
  GradingCompany,
  PokemonCard,
  PriceStrategy,
  ScanItem,
} from "@/lib/types";
import { apiPath } from "@/lib/client/basePath";

interface Props {
  item: ScanItem;
  /** Whether the signed-in seller has linked an eBay account (drives posting). */
  ebayConnected: boolean;
  onChange: (patch: Partial<ScanItem>) => void;
  /** Jump to the next card still being worked (null when there isn't one). */
  onNext?: (() => void) | null;
  /** Grade the whole queue at once — sets this condition on every unfinished card. */
  onApplyConditionToAll?: (condition: Condition) => void;
  /** Drop this card from the queue and the ledger (the page owns the undo window). */
  onRemove?: () => void;
}

const READ_STEPS = [
  "Reading the name and number",
  "Matching the set",
  "Pricing it",
] as const;
/* The identification call is one opaque request, so the tracker is timed to
   how long each part typically takes; the last step holds until the real
   result lands (the item leaves "scanning" and this state unmounts). */
const READ_STAGE_MS = [1400, 3200];

/** The right pane while a scan is queued or being read: the seller's photo
    in a scanner frame (laser sweep + holo brackets, like the camera guide)
    over a staged tracker. Lives inside `.scanner-hud` so the motion — which
    is feedback, not decoration — survives reduced-motion. Keyed by item id
    by the caller so a new item restarts the clock. */
function ReadingState({ item }: { item: ScanItem }) {
  const scanning = item.status === "scanning";
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (!scanning) return;
    const timers = READ_STAGE_MS.map((ms, i) =>
      window.setTimeout(() => setStage(i + 1), ms),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [scanning]);

  const bracket = scanning ? "border-holo-pink" : "border-zinc-600";

  return (
    <div className="scanner-hud flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
      <div
        className={`relative aspect-[63/88] h-56 transition-opacity ${scanning ? "" : "opacity-50"}`}
        aria-hidden
      >
        <div className="absolute inset-0 overflow-hidden rounded-xl bg-black/50 shadow-2xl shadow-black/50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.previewUrl}
            alt=""
            className="h-full w-full object-contain"
          />
          {scanning && <span className="scan-sweep" />}
        </div>
        <span className={`absolute -left-px -top-px h-8 w-8 rounded-tl-xl border-l-3 border-t-3 transition-colors ${bracket}`} />
        <span className={`absolute -right-px -top-px h-8 w-8 rounded-tr-xl border-r-3 border-t-3 transition-colors ${bracket}`} />
        <span className={`absolute -bottom-px -left-px h-8 w-8 rounded-bl-xl border-b-3 border-l-3 transition-colors ${bracket}`} />
        <span className={`absolute -bottom-px -right-px h-8 w-8 rounded-br-xl border-b-3 border-r-3 transition-colors ${bracket}`} />
      </div>

      <div role="status" aria-live="polite">
        <p className="font-display text-base font-semibold text-white">
          {scanning ? "Reading the card…" : "Waiting in queue"}
        </p>
        <ol className="mt-3 space-y-1.5 text-left text-sm">
          {READ_STEPS.map((label, i) => {
            const done = scanning && i < stage;
            const active = scanning && i === stage;
            return (
              <li
                key={label}
                className={`flex items-center gap-2.5 transition-colors ${
                  done ? "text-emerald-400" : active ? "text-white" : "text-zinc-500"
                }`}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {done ? (
                    <svg
                      viewBox="0 0 16 16"
                      className="h-4 w-4 animate-fade-up"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M3 8.5l3 3 7-7" />
                    </svg>
                  ) : active ? (
                    <span className="h-2 w-2 rounded-full bg-holo-pink shadow-[0_0_8px_var(--color-holo-pink)] animate-pulse" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
                  )}
                </span>
                {label}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/** PSA slab verification: cert number → PSA's own record. Fills the grade,
    remembers the cert on the item, and shows what PSA says the card is so a
    mislabeled slab is caught before it's priced. Budgeted hard server-side
    (PSA free tier = 100 lookups/day app-wide) — one click, one call. */
function PsaCertVerify({
  grading,
  onVerified,
}: {
  grading: GradedInfo;
  onVerified: (grading: GradedInfo) => void;
}) {
  const [cert, setCert] = useState(grading.cert ?? "");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ label: string; gradeDescription: string; totalPopulation: number | null } | null>(null);

  async function verify() {
    const certNumber = cert.trim();
    if (!certNumber || checking) return;
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(apiPath(`/api/psa/cert/${encodeURIComponent(certNumber)}`));
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "PSA lookup failed — try again");
        return;
      }
      const found = data.cert as {
        certNumber: string;
        grade: string | null;
        gradeDescription: string;
        label: string;
        totalPopulation: number | null;
      };
      setResult(found);
      // Only grades on PSA's real ladder land in the dropdown; an odd one
      // (qualifiers, DNA) leaves the seller's pick alone and just shows.
      const grade = found.grade && gradesFor("PSA").includes(found.grade) ? found.grade : grading.grade;
      onVerified({ company: "PSA", grade, cert: found.certNumber });
    } catch {
      setError("PSA lookup failed — check your connection");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-zinc-300" htmlFor="psa-cert">
        PSA cert number{" "}
        <span className="font-normal text-zinc-500">(on the slab label — verifies the grade)</span>
      </label>
      <div className="flex gap-2">
        <input
          id="psa-cert"
          value={cert}
          onChange={(e) => setCert(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void verify()}
          inputMode="numeric"
          placeholder="e.g. 82345678"
          className="w-40 rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400"
        />
        <button
          type="button"
          onClick={() => void verify()}
          disabled={checking || !cert.trim()}
          className="flex items-center gap-2 rounded-lg border border-edge px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-edge-strong hover:text-white disabled:opacity-50"
        >
          {checking && <Spinner className="h-3.5 w-3.5" />}
          Verify
        </button>
      </div>
      {result && (
        <p className="text-xs leading-snug text-emerald-400">
          ✓ PSA {result.gradeDescription}: {result.label}
          {result.totalPopulation != null && (
            <span className="text-zinc-500"> · pop {result.totalPopulation.toLocaleString()}</span>
          )}
        </p>
      )}
      {!result && grading.cert && !error && (
        <p className="text-xs text-zinc-500">Cert {grading.cert} verified earlier.</p>
      )}
      {error && (
        <p className="text-xs text-red-400">
          {error}{" "}
          <Link
            href="/help/graded"
            className="text-zinc-400 underline underline-offset-2 transition hover:text-zinc-200"
          >
            How Graded Cards Work
          </Link>
        </p>
      )}
    </div>
  );
}

/** Session cache of graded comps per card+grade — grade flips shouldn't re-ask eBay. */
const gradedCompsCache = new Map<string, { average: number; count: number } | null>();

export default function CardEditor({ item, ebayConnected, onChange, onNext, onApplyConditionToAll, onRemove }: Props) {
  // Pricing only (10-04): no listing price, listing copy or eBay buttons; market data stays.
  const pricingOnly = Boolean(useSession().user?.pricingOnly);
  // Condition-change feedback (QA leftover): the price moves silently
  // otherwise, and a seller picking Lightly Played wonders if it took.
  const [conditionNote, setConditionNote] = useState<string | null>(null);
  // "Change" on the condition suggestion jumps to this select.
  const conditionSelectRef = useRef<HTMLSelectElement | null>(null);
  useEffect(() => {
    if (!conditionNote) return;
    const t = window.setTimeout(() => setConditionNote(null), 2600);
    return () => window.clearTimeout(t);
  }, [conditionNote]);

  // US sellers: the original floor. A seller on another eBay site: that site's break-even in their currency.
  const priceFloor = usePriceFloor();

  const [term, setTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showAlternatives, setShowAlternatives] = useState(false);
  // "Not your card?" lists EVERY printing that shares the name — Charizard,
  // Charizard ex, V, VMAX, Mega, Dark — not the scanner's top two dozen
  // (Chris, 09-04: "so it's impossible not to find"). Loaded when opened,
  // keyed by the card it was loaded for so a swap reloads.
  const [allMatches, setAllMatches] = useState<{ forId: string; cards: PokemonCard[] } | null>(null);
  const [allLoading, setAllLoading] = useState(false);
  // Testing aid (Chris, 09-03): a match the seller changed is a mismatch
  // worth tracing. Records what the scanner had picked, in the same tag
  // My Cards and the queue show for a doubtful read.
  const correctedFrom = (): string | null =>
    item.card ? `corrected from ${item.card.englishName || item.card.name} (${item.card.setName})`.slice(0, 80) : item.matchDoubt;
  const [wishlisted, setWishlisted] = useState(false);
  const [wishlisting, setWishlisting] = useState(false);

  const card = item.card;
  // Slab comps: what copies at exactly this grade are listed for on eBay.
  // Fetched when the seller sets/changes the grade — turns the "raw market
  // is only a floor" note into a real graded number (Chris, 09-02).
  // Fetched value + derived view. Everything shown derives during render —
  // cache hits apply instantly with no setState-in-effect (the lint rule that
  // broke CI), and while a new grade loads the previous fetched number stays
  // on screen (the double-jump fix). settledKey ends the loading state even
  // when a failed fetch caches nothing.
  const [fetchedGradedComps, setFetchedGradedComps] = useState<{ average: number; count: number } | null>(null);
  // 1st Edition ↔ unlimited: the other printing is a separate catalog card.
  const [swapping, setSwapping] = useState(false);
  const [gradedSettledKey, setGradedSettledKey] = useState("");
  const gradeKey = item.grading ? `${item.grading.company}:${item.grading.grade}:${card?.id ?? ""}` : "";
  const gradedCacheHit = gradeKey ? gradedCompsCache.get(gradeKey) : undefined;
  const gradedComps = !gradeKey ? null : gradedCacheHit !== undefined ? gradedCacheHit : fetchedGradedComps;
  const gradedCompsLoading = Boolean(gradeKey) && gradedCacheHit === undefined && gradedSettledKey !== gradeKey;
  useEffect(() => {
    if (!gradeKey || !card || !item.grading) return;
    // Cached grade: rendered from the cache directly — nothing to fetch.
    if (gradedCompsCache.get(gradeKey) !== undefined) return;
    let stale = false;
    void fetchEbayComps(card, item.grading).then((res) => {
      const value =
        res.comps && res.comps.count >= 2
          ? { average: res.comps.average, count: res.comps.count }
          : null;
      // Cache even the misses so a grade with no market doesn't refetch per flip.
      if (res.status === "done" || res.status === "empty") gradedCompsCache.set(gradeKey, value);
      if (stale) return;
      setGradedSettledKey(gradeKey);
      setFetchedGradedComps(value);
      // Warm the grades either side of this one in the background — sellers
      // flip between adjacent grades comparing prices, and a warm cache makes
      // that instant (rate limit is 60/min; two extra calls is nothing).
      const scale = gradesFor(item.grading!.company);
      const at = scale.indexOf(item.grading!.grade);
      for (const neighbor of [scale[at - 1], scale[at + 1]]) {
        if (!neighbor) continue;
        const nKey = `${item.grading!.company}:${neighbor}:${card.id}`;
        if (gradedCompsCache.has(nKey)) continue;
        void fetchEbayComps(card, { company: item.grading!.company, grade: neighbor }).then((n) => {
          if (n.status === "done" || n.status === "empty") {
            gradedCompsCache.set(
              nKey,
              n.comps && n.comps.count >= 2 ? { average: n.comps.average, count: n.comps.count } : null,
            );
          }
        });
      }
    });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradeKey]);

  // Graded pricing follows the slab market, not the raw card: the strategy
  // tiles price off the graded average, and Your price snaps to it when the
  // comps land — unless the seller already typed their own number (Chris,
  // 09-02: "all these prices should reflect the psa price").
  const gradedMarket = gradedComps ? Math.round(gradedComps.average * 100) / 100 : null;
  const gradedQuick = gradedComps ? Math.round(gradedComps.average * 0.88 * 100) / 100 : null;
  const autoGradedPrice = useRef<number | null>(null);
  useEffect(() => {
    if (!item.grading || gradedMarket === null || gradedQuick === null) return;
    const target = item.strategy === "quick" ? gradedQuick : gradedMarket;
    const current = item.priceOverride;
    // Only replace a price we set ourselves (or none) — never a typed one.
    if (current !== null && current !== autoGradedPrice.current) return;
    if (current === target) return;
    autoGradedPrice.current = target;
    onChange({ priceOverride: target });
    if (item.serverId) void updateServerCard(item.serverId, { price: target, priceLocked: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradedMarket, gradedQuick, item.strategy, item.grading]);

  // Hook, so it lives above the early returns (empty id = no fetch). The
  // chart's current-day point drives the quote when it's allowed to (see
  // pointCanRebase in lib/listing.ts) — the Market tile and the price history
  // must not tell the seller two different "today" numbers (Chris, 09-01).
  // The page stores the point on the item; the hook here is variant-aware
  // (1st Edition toggle) and fresher, so when it differs it's written back
  // onto the item — one point for the tiles, Your price, the queue row and
  // the ledger alike.
  const hookPoint = useLastRecordedPrice(card?.id ?? "", effectiveVariant(item) ?? null);
  const currentPoint = hookPoint ?? item.currentPoint ?? null;
  // Shipping pick (10-08), hooks above the early returns: the envelope tile is off once the price it
  // would give is $100 or more (the envelope cap); a card that grew past the cap after an
  // envelope pick flips to tracked.
  const envelopeQuote = card ? quotePrice(card, item.condition, item.strategy, effectiveVariant(item), currentPoint, "envelope") : null;
  const envelopeOk = envelopeQuote ? envelopeAllowed(item.priceOverride ?? envelopeQuote.suggested) : true;
  const { shipping: shippingPick } = item;
  const [shipHelp, setShipHelp] = useState(false);
  useEffect(() => {
    if (shippingPick === "envelope" && !envelopeOk) onChange({ shipping: "tracked", priceOverride: null });
  }, [shippingPick, envelopeOk, onChange]);
  useEffect(() => {
    if (!hookPoint) return;
    if (JSON.stringify(hookPoint) === JSON.stringify(item.currentPoint ?? null)) return;
    onChange({ currentPoint: hookPoint });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hookPoint]);

  async function runSearch() {
    if (!term.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      // "Charizard 4/102" — the number the seller can see is the fastest way
      // to correct a wrong match, so accept it alongside the name.
      const found = (await searchTyped(term, item.game ?? "pokemon", item.language, { limit: 24, exact: false })) ?? [];
      if (found.length === 0) {
        setSearchError("No cards matched that search.");
      } else {
        onChange({
          candidates: found,
          card: found[0],
          status: found.length === 1 ? "ready" : "review",
          verifiedAt: null,
          matchDoubt: item.card && item.card.id !== found[0].id ? correctedFrom() : item.matchDoubt,
          // Different card, so the old comps no longer describe it — clearing
          // the status re-triggers the lookup for the new match.
          ebay: null,
          ebayStatus: "idle",
          ebaySold: null,
          ebaySoldStatus: "unavailable",
          error: null,
        });
        setShowAlternatives(found.length > 1);
      }
    } catch {
      setSearchError("Search failed — check your connection.");
    } finally {
      setSearching(false);
    }
  }

  const manualSearch = (
    <div className="w-full max-w-sm">
      <label
        htmlFor="manual-search"
        className="mb-1.5 block text-sm font-medium text-zinc-300"
      >
        Search by card name
      </label>
      <div className="flex gap-2">
        <input
          id="manual-search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch()}
          placeholder={item.game === "mtg" ? "e.g. Lightning Bolt LTR 187" : "e.g. Charizard 4/102"}
          className="flex-1 rounded-lg border border-edge bg-black/40 px-3 py-2 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400"
        />
        <button
          onClick={runSearch}
          disabled={searching}
          className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200 disabled:opacity-60"
        >
          {searching && <Spinner className="h-3.5 w-3.5" />}
          Search
        </button>
      </div>
      {searchError && (
        <p className="mt-2 text-xs text-red-400">{searchError}</p>
      )}
    </div>
  );

  if (item.status === "scanning" || item.status === "queued") {
    return <ReadingState key={item.id} item={item} />;
  }

  if (!card) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.previewUrl}
          alt=""
          className="h-40 w-auto rounded-xl opacity-60 shadow-xl shadow-black/40"
        />
        <div>
          <p className="font-medium text-white">
            {item.error ?? "Couldn't identify this card"}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            Photos work best straight-on, with the name at the top in focus.
          </p>
        </div>
        {/* A failed read is not a dead end (Chris, 09-01 QoL pass): re-run
            the same photo (lookups flake), or fall through to the name search
            below. The page re-pumps whenever an item returns to "queued". */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {item.file && (
            <button
              onClick={() =>
                onChange({ status: "queued", error: null, visionStatus: "idle", vision: null, verifiedAt: null })
              }
              className="rounded-full bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200"
            >
              Scan again
            </button>
          )}
          {/* "Use a different photo" (a file picker) went 10-03 with every upload: a new shot comes from the camera. */}
        </div>
        {manualSearch}
        <MissingCardReport
          game={item.game ?? "pokemon"}
          typed={term}
          read={item.vision ? { name: item.vision.englishName || item.vision.name, setName: item.vision.setName, number: item.vision.cardNumber } : null}
        />
      </div>
    );
  }

  if (item.status === "listed") {
    return <ListedPanel item={item} onChange={onChange} onNext={onNext} />;
  }

  if (item.status === "sold") {
    return <SoldPanel item={item} onChange={onChange} onNext={onNext} />;
  }

  const firstEdEligible = canBeFirstEdition(card);
  const isFirstEdition = isFirstEditionCard(card);

  const variant = effectiveVariant(item);
  const quote = quoteForItem(item, currentPoint);
  const quickQuote = quotePrice(card, item.condition, "quick", variant, currentPoint, item.shipping);
  const marketQuote = quotePrice(card, item.condition, "market", variant, currentPoint, item.shipping);
  // The price guard: the market behind this card is one the rule does not believe, so no price is suggested (quote is null) and the note says why.
  const priceFlag = priceFlagOf(card, variant, currentPoint);
  // The market behind the quote has not updated in 45+ days (10-02): the quote stands, a line under it says so.
  const priceStale = priceStaleOf(card, variant, currentPoint);
  // Quick sale is a $5+ option (Chris, 09-03): under that, the only tile is
  // Market and it reads as selected whatever the remembered strategy says
  // (quotePrice already prices "quick" as market there). The test is on the
  // card's VALUE: a $4 card's covered price ($5.83) is not a $5+ card.
  const showQuick = Boolean(item.grading) || quickSaleEligible(marketQuote?.covers ?? marketQuote?.suggested);
  const selectedStrategy: PriceStrategy = showQuick ? item.strategy : "market";

  const facts = { firstEdition: itemFirstEdition(item), grading: item.grading };

  // Magic names are exact — no suffix stripping there (lib/speciesName.ts).
  const speciesName = (name: string): string => (item.game === "mtg" ? name : speciesOf(name));
  // Yu-Gi-Oh!: one set code in several foils — the seller's tap picks it (09-29).
  // One Piece: one number in several printings (standard / parallel / alt
  // art / manga / reprint) — same tap, with a thumbnail since the arts differ (09-30).
  const foils =
    item.game === "yugioh" ? foilChoices(card, item.candidates) : item.game === "onepiece" ? printingChoices(card, item.candidates) : [];
  const foilName = (c: PokemonCard) => (item.game === "onepiece" ? printingLabel(c) : foilLabel(c));
  const alternatives: PokemonCard[] =
    allMatches?.forId === card.id ? allMatches.cards : item.candidates;

  // Arrow, not a declaration: hoisted functions do not inherit the `card`
  // null guard above, an arrow created after it does.
  const openAlternatives = async () => {
    setShowAlternatives(true);
    if (allMatches?.forId === card.id || allLoading) return;
    setAllLoading(true);
    const base = speciesName(card.englishName || card.name);
    const found = await searchCards(base, null, item.language, 200, item.game).catch(() => [] as PokemonCard[]);
    setAllLoading(false);
    const seen = new Set<string>();
    const merged: PokemonCard[] = [];
    // The scanner's own ranking first (the likely fixes), then everything else.
    for (const c of [...item.candidates, ...found]) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      merged.push(c);
    }
    setAllMatches({ forId: card.id, cards: merged });
  };

  /** Switch this item to the other printing's catalog card (the "-1st" twin
   *  or the unlimited card) — a different product with its own price. */
  async function swapPrinting(targetId: string) {
    setSwapping(true);
    setSearchError(null);
    const other = await fetchCardById(targetId, "pokemon").catch(() => null);
    setSwapping(false);
    if (!other) {
      setSearchError("Couldn't load that printing right now — try again in a moment.");
      return;
    }
    onChange({
      card: other,
      candidates: [other, ...item.candidates.filter((c) => c.id !== other.id)],
      status: "ready",
      verifiedAt: null,
      priceOverride: null,
      variant: null,
      firstEdition: isFirstEditionCard(other),
      ebay: null,
      ebayStatus: "idle",
      ebaySold: null,
      ebaySoldStatus: "unavailable",
    });
  }

  // Grade/condition changes reach the ledger immediately, not just at the
  // listed/sold checkpoint (Chris, 09-01: graded cards matter — a resumed
  // draft must come back as the slab it is, and My Cards shouldn't call a
  // PSA 10 "Near Mint"). The ledger's condition string is the one source:
  // "PSA 10" for slabs, the raw scale otherwise; resume parses it back.
  function syncLedgerCondition(next: Partial<ScanItem>) {
    if (!item.serverId) return;
    const merged = { ...item, ...next } as ScanItem;
    // A condition change re-quotes the ledger price too (Chris, 09-10: "the
    // price seems to always stay the same") and unlocks it, so Inventory and
    // the live refresh land on the number this editor shows. Grading keeps
    // its own path: the graded auto-price effect writes that one.
    const requote =
      "condition" in next && !merged.grading
        ? quoteForItem({ ...merged, priceOverride: null }, currentPoint)?.suggested
        : undefined;
    void updateServerCard(item.serverId, {
      condition: describeItemCondition(merged),
      ...(requote ? { price: requote, priceLocked: false } : {}),
    });
  }
  const price = item.priceOverride ?? quote?.suggested ?? 0;
  const verified = Boolean(item.verifiedAt) || Boolean(item.ebayOfferId);
  // History chart altitude: the raw NM curve's shape is real demand signal,
  // but a slab or played copy lives at a different level — rescale the chart
  // to the graded average (ratio vs the raw quote it floors on) or the
  // condition multiplier, labeled as an estimate (Chris, 09-02: a flat raw
  // curve under a PSA 10 price "seems off").
  const historyScale = item.grading
    ? gradedMarket !== null && quote?.base
      ? gradedMarket / quote.base
      : null
    : item.condition !== "Near Mint"
      ? CONDITION_MULTIPLIER[item.condition]
      : null;
  const historyScaleLabel = item.grading
    ? `${gradeLabel(item.grading)} est.`
    : `${item.condition} est.`;
  // Recorded graded curve, once the comps route has banked enough lookups —
  // the chart prefers this series and drops the estimate when it exists.
  const historyPreferVariant = item.grading
    ? `graded-${item.grading.company.toLowerCase()}-${item.grading.grade.match(/\d+(?:\.\d+)?/)?.[0] ?? item.grading.grade}`
    : null;
  const generated = buildListing(
    card,
    price,
    item.condition,
    quote?.price.label,
    facts,
  );
  const listing = withListingOverrides(generated, item);
  // The Printing dropdown's rows: real printings with a dollar price, one
  // per variant. eBay comps rows are a price basis, not a printing; the
  // 1st Edition rows belong to the toggle on eligible WotC-era cards.
  const printings = card.prices.filter(
    (p, i, all) =>
      p.market != null &&
      p.market > 0 &&
      canPriceListing(p) &&
      p.source !== "ebay" &&
      p.variant !== "average" &&
      !(firstEdEligible && isFirstEditionVariant(p.variant)) &&
      all.findIndex((q) => q.variant === p.variant) === i,
  );
  async function handleWishlist() {
    if (!card) return;
    setWishlisting(true);
    const result = await addToWishlist(card, item.language, quote?.base ?? null);
    setWishlisting(false);
    if (result) setWishlisted(true);
  }

  return (
    // Internal scrolling is a desktop-grid thing; on mobile the page itself
    // scrolls, and an overflow container here would swallow the publish row's
    // sticky positioning (sticky pins to the nearest scrollport).
    <div className="flex flex-col gap-6 p-6 sm:p-8 lg:h-full lg:overflow-y-auto">
      <div className="flex flex-col gap-5 sm:flex-row">
        {/* The seller's photo stays beside the match. Showing only the matched
            card's official art made a wrong match invisible — there was
            nothing left to compare it against. */}
        {/* One card on a lit stage with a Match / Your Photo switch (09-28
            makeover); search-added cards have no photo, so no switch.
            Centering is drawn on the photo for Pokémon only. */}
        <MatchHero
          photoSrc={item.previewUrl || null}
          centering={item.game === "pokemon"}
          match={
            card.imageLarge || card.imageSmall ? (
              <CardImage src={card.imageLarge || card.imageSmall} alt={card.name} className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              // No catalogue art (some promos, kits). Used to fall back to the
              // seller's own photo, which read as "the match is a mirror of my
              // card" (Chris, 09-03). Say what's missing instead.
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 border border-dashed border-edge-strong px-3 text-center">
                <p className="text-sm font-medium text-zinc-300">{card.name}</p>
                <p className="text-xs text-zinc-500">
                  {card.setName} · {displayCardNumber(card)}
                </p>
                <p className="mt-2 text-[10px] uppercase tracking-wide text-zinc-600">No catalogue art yet</p>
              </div>
            )
          }
        />

        <div className="min-w-0 flex-1">
          {/* Header makeover (Chris, 09-03: "kinda sloppy"): title row with
              the watchlist action, one verify strip, then a single facts
              panel (rarity · market · eBay asking) instead of loose chips.
              The "Not this card?" toggle is gone — other matches only
              appear after a name search. */}
          {/* Phones: the name gets the full width and the actions sit on
              their own row under it (Chris, 09-28: long names were sharing
              the row with Watch / Delete). Desktop keeps one row. */}
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-semibold leading-tight text-white [overflow-wrap:anywhere]">
                {card.englishName || card.name}
                {/* The printed name stays visible when it differs -- it is how
                    the physical card in hand is verified against the match. */}
                {card.englishName && card.englishName !== card.name && (
                  <span className="ml-2 text-base font-normal text-zinc-500">{card.name}</span>
                )}
              </h2>
              <p className="mt-0.5 text-sm text-zinc-400">
                {card.setName} · {displayCardNumber(card)}
                {card.isSecretRare ? " · Secret rare" : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={handleWishlist}
                disabled={wishlisting || wishlisted}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition disabled:cursor-default ${
                  wishlisted
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "border border-edge text-zinc-400 hover:border-edge-strong hover:text-zinc-200"
                }`}
              >
                {wishlisting && <Spinner className="h-3 w-3" />}
                {wishlisted ? "★ Watching" : "☆ Watch"}
              </button>
              {/* Delete from the listing screen (Chris, 09-03) — same
                  remove-with-undo as the queue row, so no confirm dialog. */}
              {onRemove && (
                <button
                  onClick={onRemove}
                  className="rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-500 transition hover:border-red-400/40 hover:text-red-300"
                >
                  Delete
                </button>
              )}
            </div>
          </div>

          {/* The gate (Chris, 09-03): nothing reaches eBay until the seller
              has looked at the match and said so. One tap, remembered on
              the ledger row, cleared by any change of card. */}
          {(item.status === "ready" || item.status === "review") &&
            (item.verifiedAt ? (
              // Verification is final (Chris, 09-03) — no Undo; only a change
              // of card clears it.
              <p className="mt-3 text-sm">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 font-medium text-emerald-400">
                  ✓ Match verified
                </span>
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4">
                <div className="min-w-0">
                  <p className="font-display text-lg font-semibold text-white">Is this your card?</p>
                  <p className="mt-0.5 text-sm text-zinc-400">
                    Same name, set and number as the one in your hand?
                    {item.visionStatus === "done" &&
                      item.vision &&
                      item.vision.confidence < LOW_CONFIDENCE &&
                      ` The photo was hard to read (${Math.round(item.vision.confidence * 100)}% sure).`}
                  </p>
                </div>
                {/* Yu-Gi-Oh!: one set code, several foils — the photo can't
                    always tell them apart, the seller can (09-29). */}
                {item.printingsCheck === "loading" ? (
                  <p className="flex items-center justify-center gap-2 py-2 text-sm text-zinc-400">
                    <Spinner className="h-3.5 w-3.5" /> Checking the printings…
                  </p>
                ) : item.printingsCheck === "failed" ? (
                  // No plain "Yes": the printing is confirmed before the listing opens (Chris, 10-01).
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-amber-200">Couldn&apos;t load this card&apos;s printings, so it can&apos;t be verified yet.</p>
                    <button
                      type="button"
                      onClick={() => {
                        onChange({ printingsCheck: "loading" });
                        void searchCards(card.englishName || card.name, card.number || null, "en", undefined, item.game)
                          .then((found) => {
                            const others = found.filter((c) => c.id !== card.id);
                            onChange({ ...(others.length > 0 ? { candidates: [card, ...others] } : {}), printingsCheck: null });
                          })
                          .catch(() => onChange({ printingsCheck: "failed" }));
                      }}
                      className="w-full rounded-full bg-amber-400 px-5 py-3 text-sm font-semibold text-black transition hover:bg-amber-300"
                    >
                      Try Again
                    </button>
                  </div>
                ) : foils.length >= 2 ? (
                  // One tap answers both questions (Chris 09-29): the foil
                  // picked IS the verification. Wrong card entirely → the
                  // "Not your card?" link below.
                  <div data-tour="verify">
                    <p className="text-sm font-medium text-white">
                      {item.game === "onepiece" ? "Which printing is yours? Tap it to confirm." : "Which foil is yours? Tap it to confirm."}
                    </p>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {foils.map((c) => (
                        <button
                          key={c.id}
                          onClick={() =>
                            onChange(
                              c.id === card.id
                                ? { verifiedAt: Date.now(), status: "ready", error: null, matchDoubt: null }
                                : {
                                    card: c,
                                    verifiedAt: Date.now(),
                                    status: "ready",
                                    error: null,
                                    matchDoubt: null,
                                    priceOverride: null,
                                    variant: null,
                                    firstEdition: isFirstEditionCard(c),
                                    grading: null,
                                    ebay: null,
                                    ebayStatus: "idle",
                                    ebaySold: null,
                                    ebaySoldStatus: "unavailable",
                                  },
                            )
                          }
                          className={`flex items-center justify-center gap-3 rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                            c.id === card.id
                              ? "bg-emerald-500 text-white hover:bg-emerald-400"
                              : "border border-edge text-zinc-200 hover:border-edge-strong hover:text-white"
                          }`}
                        >
                          {item.game === "onepiece" && c.imageSmall ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={c.imageSmall} alt="" className="h-9 w-[26px] shrink-0 rounded-sm object-cover" />
                          ) : null}
                          <span>{foilName(c)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <button
                    data-tour="verify"
                    onClick={() => onChange({ verifiedAt: Date.now(), status: "ready", error: null, matchDoubt: null })}
                    className="w-full rounded-full bg-emerald-500 px-5 py-3.5 text-base font-semibold text-white transition hover:bg-emerald-400"
                  >
                    Yes, this is my card
                  </button>
                )}
              </div>
            ))}

          {verified && (() => {
            // One facts panel: label-over-value cells with hairline dividers.
            const cells: { label: string; value: React.ReactNode }[] = [];
            if (item.grading) cells.push({ label: "Grade", value: <span className="text-sky-300">{gradeLabel(item.grading)}</span> });
            else if (card.rarity) cells.push({ label: "Rarity", value: <span className="text-brand-300">{card.rarity}</span> });
            if (quote) {
              const ebayBasis = /^eBay/i.test(quote.price.label);
              const listingsLink = (
                <a
                  href={item.ebay?.searchUrl ?? ebaySearchUrl(card, facts)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-xs text-zinc-500 underline decoration-zinc-600 underline-offset-2 hover:text-white"
                >
                  {item.ebay && item.ebay.count > 0 ? `${item.ebay.count} listing${item.ebay.count === 1 ? "" : "s"} ↗` : "See listings ↗"}
                </a>
              );
              cells.push({
                label: "Market",
                value: (
                  <>
                    {quote.price.currency === "USD" ? (
                      <Price usd={quote.base} className="font-display text-white" />
                    ) : (
                      <span className="font-display text-white">{formatMoney(quote.base, quote.price.currency)}</span>
                    )}
                    {/* The basis on its own line (10-08, Chris: "$1,134.85 1st …" was clipped beside the number). */}
                    <span className="block truncate text-xs text-zinc-500">{quote.price.label}</span>
                  </>
                ),
              });
              // "eBay asking" is OUR number (Chris 10-08): the market price through condition, fees and shipping,
              // never the average of other sellers' live listings (those stay as the small link). Always the
              // FULL-value quote: with Quick sale picked, quote.suggested is the 12%-off number ($1,151.75 on
              // a $1,134.85 Lugia, which read as "fees missing" to Chris); the Quick tile below shows that one.
              const askingQuote = marketQuote ?? quote;
              cells.push({
                label: "eBay asking",
                value: (
                  <>
                    <span className="font-display text-white">{formatMoney(askingQuote.suggested, askingQuote.price.currency)}</span>
                    {ebayBasis ? <span className="block truncate text-xs text-zinc-500">{quote.price.label}</span> : null}
                    {listingsLink}
                  </>
                ),
              });
            }
            if (cells.length === 0) return null;
            return (
              <dl
                className="mt-3 grid divide-x divide-white/10 overflow-hidden rounded-xl border border-edge bg-surface-1"
                style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
              >
                {cells.map((c) => (
                  <div key={c.label} className="min-w-0 px-3 py-2">
                    <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{c.label}</dt>
                    <dd className="mt-0.5 text-sm font-medium">{c.value}</dd>
                  </div>
                ))}
              </dl>
            );
          })()}

          {/* The grade drives the price, so say what the photo showed rather
              than silently applying a multiplier the seller can't check. */}
          {verified && item.vision?.condition && (() => {
            // Condition suggestion (09-27, Tier 1 #3): the photo's call is
            // already priced in; here the seller sees why and either agrees
            // or changes it. A manual change of the Condition select is the
            // override, so the strip shrinks to one line either way.
            const v = item.vision;
            const suggested = v.condition;
            const overridden = item.condition !== suggested;
            if (item.conditionAgreed && !overridden) {
              return (
                <p className="mt-2 text-sm text-zinc-500">
                  <span className="text-emerald-400">✓</span> {suggested}, agreed from the photo
                </p>
              );
            }
            if (overridden) {
              return (
                <p className="mt-2 text-sm text-zinc-500">
                  You set {item.condition}. The photo suggested {suggested}
                  {v.conditionNotes ? `: ${v.conditionNotes}` : "."}
                </p>
              );
            }
            const parts: { label: string; level: WearLevel | null | undefined }[] = [
              { label: "Corners", level: v.corners },
              { label: "Edges", level: v.edges },
              { label: "Surface", level: v.surface },
            ];
            const seen = parts.filter((p) => p.level != null);
            const tone = (l: WearLevel) =>
              l === "clean" ? "text-emerald-400" : l === "light wear" ? "text-amber-300" : "text-rose-400";
            return (
              <div className="mt-3 rounded-xl border border-edge bg-surface-1 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Condition from the photo</p>
                <p className="mt-0.5 font-display text-lg font-semibold text-white">{suggested}</p>
                {seen.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                    {seen.map((p) => (
                      <span key={p.label} className="text-zinc-500">
                        {p.label} <span className={tone(p.level!)}>{p.level}</span>
                      </span>
                    ))}
                  </p>
                )}
                {v.conditionNotes && <p className="mt-1 text-sm leading-snug text-zinc-400">{v.conditionNotes}</p>}
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onChange({ conditionAgreed: true })}
                    className="rounded-full bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/25"
                  >
                    Looks Right
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const el = conditionSelectRef.current;
                      el?.scrollIntoView({ behavior: "smooth", block: "center" });
                      el?.focus();
                    }}
                    className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-edge-strong hover:text-white"
                  >
                    Change
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Back by request (Chris, 09-03, after the stress test): the
              other matches are the one-tap fix for a blurry-photo
              misidentification. Hidden once the match is verified. */}
          {!item.verifiedAt && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-xs text-zinc-500">
                {showAlternatives &&
                  (allLoading ? (
                    <>
                      <Spinner className="h-3 w-3" /> Loading every {speciesName(card.englishName || card.name)} printing…
                    </>
                  ) : (
                    `Every ${speciesName(card.englishName || card.name)} printing (${alternatives.length}) — tap yours`
                  ))}
              </p>
              <button
                onClick={() => (showAlternatives ? setShowAlternatives(false) : void openAlternatives())}
                className="shrink-0 text-xs text-brand-300 underline underline-offset-4 hover:text-brand-200"
              >
                {showAlternatives ? "Hide" : `Not your card? See every ${speciesName(card.englishName || card.name)}`}
              </button>
            </div>
          )}

          {showAlternatives && (
            <div className="mt-2 grid max-h-[60vh] grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-5">
              {alternatives.map((c: PokemonCard) => (
                <button
                  key={c.id}
                  onClick={() => {
                    onChange({
                      card: c,
                      status: "ready",
                      verifiedAt: null,
                      matchDoubt: c.id !== card.id ? correctedFrom() : item.matchDoubt,
                      priceOverride: null,
                      variant: null,
                      firstEdition: isFirstEditionCard(c),
                      grading: null,
                      ebay: null,
                      ebayStatus: "idle",
          ebaySold: null,
          ebaySoldStatus: "unavailable",
                    });
                    setShowAlternatives(false);
                  }}
                  className={`overflow-hidden rounded-md border transition hover:-translate-y-0.5 ${
                    c.id === card.id
                      ? "border-brand-400"
                      : "border-transparent hover:border-edge-strong"
                  }`}
                  title={`${c.name} — ${c.setName} ${displayCardNumber(c)}`}
                >
                  {c.imageSmall ? (
                    <CardImage
                      src={c.imageSmall}
                      alt={`${c.name}, ${c.setName}`}
                      className="aspect-[5/7] w-full"
                    />
                  ) : (
                    // A real printing with no catalogue art: name it rather
                    // than showing a blank tile.
                    <span className="flex aspect-[5/7] w-full flex-col items-center justify-center gap-0.5 bg-surface-1 px-1 text-center">
                      <span className="text-[10px] font-medium leading-tight text-zinc-300">{c.setName}</span>
                      <span className="text-[10px] text-zinc-500">{displayCardNumber(c)}</span>
                    </span>
                  )}
                  {/* Tooltips don't exist on a phone — name the printing under the art. */}
                  <span className="block truncate px-1 py-0.5 text-left text-[9px] leading-tight text-zinc-500">
                    {c.name !== card.name ? `${c.name} · ` : ""}{c.setName} {displayCardNumber(c)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* After Verify the whole listing sheet shows (Chris, 09-04 night:
          hiding it behind "Change" read as "the listing data is gone"). */}
      {verified && (
      <>
      {/* Once the seller has typed a price the note would read as a verdict on their number: it is about the market. */}
      {!quote && priceFlag && item.priceOverride == null && (
        <PriceFlagNote
          hint="Set your own price below."
          soldUrl={facts.firstEdition || item.grading ? ebaySoldSearchUrl(card, facts) : (item.ebaySoldUrl ?? ebaySoldSearchUrl(card))}
        />
      )}
      {!quote && !priceFlag && (
        <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          No market price is available for this card — set your own price below.
        </p>
      )}
      {quote && priceStale && (
        <PriceStaleNote
          className="px-1"
          days={priceStale.days}
          soldUrl={facts.firstEdition || item.grading ? ebaySoldSearchUrl(card, facts) : (item.ebaySoldUrl ?? ebaySoldSearchUrl(card))}
        />
      )}

      <MarketMetricsPanel
        card={card}
        quoted={quote?.price ?? null}
        sold={item.ebaySold}
        soldStatus={item.ebaySoldStatus}
        // The stored sold URL came from the comps lookup, which doesn't know
        // about the 1st Edition toggle or grading — rebuild it client-side
        // when either is set.
        soldUrl={
          facts.firstEdition || item.grading
            ? ebaySoldSearchUrl(card, facts)
            : (item.ebaySoldUrl ?? ebaySoldSearchUrl(card))
        }
        active={item.ebay}
        activeStatus={item.ebayStatus}
        activeUrl={ebaySearchUrl(card, facts)}
        historyScale={historyScale}
        historyScaleLabel={historyScaleLabel}
        historyPreferVariant={historyPreferVariant}
      />

      {firstEdEligible && (
        <div className="rounded-xl border border-edge bg-surface-1 p-4">
          {/* 1st Edition is its own catalog card (Chris, 09-04: "a totally
              different card with a totally different price"), so this is a
              swap between two products, not a checkbox on one. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            {isFirstEdition ? (
              <p className="flex min-w-0 items-center gap-2 text-sm text-zinc-300">
                <span className="shrink-0 rounded-full border border-brand-400/40 bg-brand-500/10 px-2 py-0.5 text-[11px] font-semibold text-brand-300">
                  1st Edition
                </span>
                <span className="text-xs text-zinc-500">Its own printing — priced against 1st Edition copies only.</span>
              </p>
            ) : (
              <p className="min-w-0 text-xs leading-snug text-zinc-500">
                {card.setName} had a 1st Edition print run. A copy with the stamp by the artwork is a
                different card with its own price.
              </p>
            )}
            <button
              type="button"
              onClick={() => void swapPrinting(isFirstEdition ? card.id.replace(/-1st$/, "") : `${card.id}-1st`)}
              disabled={swapping}
              className="shrink-0 text-xs font-medium text-brand-300 underline underline-offset-4 hover:text-brand-200 disabled:opacity-50"
            >
              {swapping ? "Switching…" : isFirstEdition ? "No stamp? Use the unlimited card" : "Has the 1st Edition stamp? Use that card"}
            </button>
          </div>
        </div>
      )}


      <div className="grid gap-4 sm:grid-cols-2">
        {GRADED_LOCKED && !item.grading ? (
          null /* no slabs notice (Chris 10-08: "you can remove the Graded slabs... text") */
        ) : (
        <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
          Graded slab
          <select
            value={item.grading?.company ?? ""}
            onChange={(e) => {
              const company = e.target.value as GradingCompany | "";
              const grading = company ? { company, grade: "10" } : null;
              onChange({ grading, priceOverride: null });
              syncLedgerCondition({ grading });
            }}
            className="rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-400"
          >
            <option value="">Raw card (not graded)</option>
            {GRADING_COMPANIES.map((company) => (
              <option key={company} value={company}>
                Graded by {company}
              </option>
            ))}
          </select>
        </label>
        )}

        {/* A slab's condition IS its grade, so the two selects swap: showing
            both would invite "PSA 10, Moderately Played". */}
        {item.grading ? (
          <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
            Grade
            <select
              value={item.grading.grade}
              onChange={(e) => {
                const grading = { ...item.grading!, grade: e.target.value };
                onChange({ grading, priceOverride: null });
                syncLedgerCondition({ grading });
              }}
              className="rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-400"
            >
              {gradesFor(item.grading.company).map((grade) => (
                <option key={grade} value={grade}>
                  {item.grading!.company} {grade}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
            Condition
            <select
              ref={conditionSelectRef}
              value={item.condition}
              onChange={(e) => {
                const condition = e.target.value as Condition;
                onChange({ condition, priceOverride: null });
                syncLedgerCondition({ condition });
                // Remembered per browser — the next scanned card starts here.
                saveCondition(condition);
                setConditionNote(`Priced as ${condition} — the suggested price below follows the condition.`);
              }}
              className="rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-400"
            >
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {conditionNote && (
              <span role="status" className="text-xs font-normal text-emerald-300">
                {conditionNote}
              </span>
            )}
            {/* Grading a whole box the same: one click instead of per-card. */}
            {onApplyConditionToAll && (
              <button
                type="button"
                onClick={() => onApplyConditionToAll(item.condition)}
                className="self-start text-[11px] font-normal text-brand-300 underline underline-offset-2 transition hover:text-brand-200"
              >
                Apply to every card in the queue
              </button>
            )}
          </label>
        )}

        {/* Printing (back 09-27, Chris: "a dropdown with all possibilities for
            that particular card and let the user pick, if the scan doesn't
            already"): every priced printing of this card — normal, reverse
            holo, holo, Poké Ball / Master Ball pattern. The pick drives the
            quote, the title and the "Printing:" line. eBay basis rows are
            not printings and stay out; when the default quote is one of
            those, the first option keeps it. Hidden while 1st Edition is
            checked — that toggle owns the printing then. Always shown
            otherwise (Chris, 09-28): one possibility = the row is there,
            greyed out, not clickable — the seller still sees which printing
            they are selling. */}
        {!item.firstEdition && !item.grading && (printings.length > 0 || quote) && (
          <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
            Printing
            <select
              disabled={printings.length + (quote && !printings.some((p) => p.variant === quote.price.variant) ? 1 : 0) < 2}
              value={item.variant ?? (printings.some((p) => p.variant === quote?.price.variant) ? quote!.price.variant : "")}
              onChange={(e) => {
                const value = e.target.value;
                onChange({ variant: value || null, priceOverride: null });
                const picked = printings.find((p) => p.variant === value);
                setConditionNote(picked ? `Priced as ${picked.label} — the title and description say so too.` : null);
              }}
              className="rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-400 disabled:cursor-not-allowed disabled:appearance-none disabled:text-zinc-400 disabled:opacity-60"
            >
              {quote && !printings.some((p) => p.variant === quote.price.variant) && (
                <option value="">Best price — {quote.price.label} — {formatMoney(quote.base, quote.price.currency)}</option>
              )}
              {printings.map((p) => (
                <option key={`${p.source}-${p.variant}`} value={p.variant}>
                  {p.label} — {p.untrusted ? "price looks off" : formatMoney(p.market ?? 0, p.currency)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {item.grading?.company === "PSA" && (
        <PsaCertVerify
          grading={item.grading}
          onVerified={(grading) => {
            onChange({ grading, priceOverride: null });
            syncLedgerCondition({ grading });
          }}
        />
      )}

      {/* The slab pricing note replaces the quick/market tiles: both of those
          are derived from raw-card market data, which only sets a floor for a
          graded copy. */}
      {item.grading && (
        <p className="rounded-lg bg-sky-400/10 px-3 py-2 text-xs leading-snug text-sky-300">
          {gradedComps ? (
            <>
              {gradeLabel(item.grading)} copies are listed on eBay around{" "}
              <strong className="font-semibold">{formatMoney(gradedComps.average, "USD")}</strong>{" "}
              ({gradedComps.count} listings, asking prices) — set your price from
              those. The raw ungraded market
              {quote ? ` (${formatMoney(quote.base, quote.price.currency)})` : ""} is
              only a floor.
            </>
          ) : gradedCompsLoading ? (
            <>Checking what {gradeLabel(item.grading)} copies are listed for on eBay…</>
          ) : (
            <>
              Couldn&apos;t find enough {gradeLabel(item.grading)} listings to price
              from, so the price below starts at the raw ungraded market
              {quote ? ` (${formatMoney(quote.base, quote.price.currency)})` : ""} as
              a floor. A {gradeLabel(item.grading)} usually sells for more — the
              eBay links above search {gradeLabel(item.grading)} sales; set your
              price from those.
            </>
          )}
        </p>
      )}

      {/* First graded lookup in flight: hold the layout with skeleton tiles
          instead of popping the section in when eBay answers. */}
      {item.grading && gradedMarket === null && gradedCompsLoading && (
        <fieldset className="flex flex-col gap-2" aria-busy="true">
          <legend className="mb-1 text-sm font-medium text-zinc-300">
            Pricing — {gradeLabel(item.grading)} market
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {[0, 1].map((i) => (
              <div key={i} className="animate-pulse rounded-xl border border-edge bg-surface-1 p-3">
                <div className="h-4 w-16 rounded bg-white/10" />
                <div className="mt-2 h-3 w-20 rounded bg-white/5" />
                <div className="mt-1.5 h-2.5 w-28 rounded bg-white/5" />
              </div>
            ))}
          </div>
        </fieldset>
      )}

      {/* Shipping pick (Chris 10-08): required before the card can be posted; the postage goes into the
          price and the buyer sees free shipping. Nothing is picked by default. */}
      {!pricingOnly && !item.grading && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 flex w-full items-center gap-2 text-sm font-medium text-zinc-300">
            <span>
              Shipping{" "}
              {!item.shipping && <span className="font-normal text-amber-300">· pick one to post on eBay</span>}
            </span>
            {/* The ? opens both sets of mailing steps (Chris 10-08: "more apparent what is expected of the seller"). */}
            <button
              type="button"
              onClick={() => setShipHelp(true)}
              aria-label="How to ship a card"
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-edge px-2.5 py-0.5 text-[11px] font-semibold text-zinc-300 transition hover:border-brand-400 hover:text-white"
            >
              <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-brand-500/20 text-[11px] text-brand-300">?</span>
              How to ship
            </button>
          </legend>
          {shipHelp && <ShippingHelpSheet picked={item.shipping} onClose={() => setShipHelp(false)} />}
          <div className="grid grid-cols-2 gap-2">
            {SHIP_OPTIONS.map((o) => {
              const allowed = o.id !== "envelope" || envelopeOk;
              const on = item.shipping === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  disabled={!allowed}
                  aria-pressed={on}
                  onClick={() => onChange({ shipping: o.id, priceOverride: null })}
                  className={`flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition ${
                    on
                      ? "border-brand-400 bg-brand-500/15 text-white"
                      : allowed
                        ? "border-edge bg-surface-1 text-zinc-200 hover:border-edge-strong"
                        : "cursor-not-allowed border-edge bg-surface-1 text-zinc-500 opacity-60"
                  }`}
                >
                  <span className="flex w-full items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">{o.label}</span>
                    <span className="font-display text-sm font-semibold">{formatMoneyPostage(o.postage)}</span>
                  </span>
                  <span className="text-[11px] leading-snug text-zinc-500">{allowed ? o.sub : ENVELOPE_OVER_CAP}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-zinc-500">
            Postage goes into your price, the buyer sees free shipping. Envelope is for sale prices under ${ENVELOPE_MAX_USD}.
          </p>
        </fieldset>
      )}

      {!pricingOnly && (item.grading ? gradedMarket !== null : Boolean(quickQuote && marketQuote)) && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-zinc-300">
            {showQuick ? "Listing price" : "Pricing"}{item.grading ? ` — ${gradeLabel(item.grading)} market` : ""}
          </legend>
          <div className={`grid gap-2 ${showQuick ? "grid-cols-2" : "grid-cols-1"}`}>
            {(
              item.grading
                ? ([
                    ["quick", "Quick sale", gradedQuick ?? 0, "Undercuts the slab market to move fast"],
                    ["market", "Full value", gradedMarket ?? 0, "What this grade is listed for"],
                  ] as [PriceStrategy, string, number, string][])
                : ([
                    // Quick shows only from a $5 value up; its cover is on the
                    // discounted value, so "Card value $X" would name the wrong X.
                    ["quick", "Quick sale", quickQuote?.suggested ?? 0, "Undercuts market to move fast"],
                    ["market", showQuick ? "Full value" : "Suggested listing price", marketQuote?.suggested ?? 0, marketQuote?.floored ? floorNote(marketQuote) : "Holds out for full value"],
                  ] as [PriceStrategy, string, number, string][])
            ).filter(([value]) => showQuick || value === "market").map(([value, label, amount, hint]) => (
              <button
                key={value}
                onClick={() => {
                  if (item.grading) {
                    // Graded: the tile IS the price (there's no quote engine
                    // for slabs) — apply it as the override directly.
                    autoGradedPrice.current = amount;
                    onChange({ strategy: value, priceOverride: amount });
                    if (item.serverId) void updateServerCard(item.serverId, { price: amount, priceLocked: true });
                  } else {
                    onChange({ strategy: value, priceOverride: null });
                  }
                  // Remembered per browser — the next scanned card starts here.
                  saveStrategy(value);
                }}
                // Two tiles = a choice (selected one lit). One tile = a
                // summary row, label left, price right — a lone full-width
                // box read as an empty form (Chris, 09-03).
                className={
                  showQuick
                    ? `rounded-xl border p-3 text-left transition ${
                        selectedStrategy === value
                          ? "border-brand-400 bg-brand-500/10"
                          : "border-edge bg-surface-1 hover:border-edge-strong"
                      }`
                    : "flex cursor-default items-center justify-between gap-4 rounded-xl border border-edge bg-surface-1 px-4 py-3 text-left"
                }
              >
                {showQuick ? (
                  <>
                    <span className="block text-[10px] font-medium uppercase tracking-wide text-zinc-500">{label}</span>
                    <span className="font-display mt-0.5 block text-xl font-semibold text-white">
                      {formatMoney(amount)}
                    </span>
                    <span className="mt-1 block text-[11px] leading-snug text-zinc-500">{hint}</span>
                  </>
                ) : (
                  <>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-zinc-200">{label}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">{hint}</span>
                    </span>
                    <span className="font-display shrink-0 text-2xl font-semibold text-white">
                      {formatMoney(amount)}
                    </span>
                  </>
                )}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {/* Copies input removed 09-03 (Chris): one card per listing. item.quantity
          still defaults to 1 everywhere downstream. */}
      <div className="grid grid-cols-1 gap-3">
        {!pricingOnly && <>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
          Your price
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">
              $
            </span>
            <PriceInput
              value={price}
              onValue={(n) => onChange({ priceOverride: n })}
              onCommit={(n) => {
                // Never under the fee floor (Chris, 09-08): lift it and say so.
                const { floor, below, refusal } = priceFloor;
                if (below(n)) {
                  onChange({ priceOverride: floor });
                  toast(refusal(), "err");
                  n = floor;
                }
                if (item.serverId) void updateServerCard(item.serverId, { price: n, priceLocked: true });
              }}
              className="w-full rounded-lg border border-edge bg-black/40 py-2.5 pl-6 pr-3 text-sm text-white outline-none transition focus:border-brand-400"
            />
          </div>
        </label>
        {/* A seller on another eBay site sees what the listing will cost in their currency. */}
        <LocalListingLine
          cardId={item.serverId}
          strategy={item.strategy}
          refreshKey={`${item.priceOverride}|${item.condition}|${item.strategy}|${item.variant}|${item.firstEdition}`}
          usd={item.priceOverride ?? quote?.base ?? null}
        />
        </>}
        {/* What they paid (09-27): optional, drives profit per card and the year-end report. */}
        <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
          <span>
            What you paid <span className="font-normal text-zinc-500">(optional, for your profit)</span>
          </span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">
              $
            </span>
            <PriceInput
              value={item.costBasis ?? 0}
              onValue={(n) => onChange({ costBasis: n })}
              onCommit={(n) => {
                onChange({ costBasis: n });
                if (item.serverId) void updateServerCard(item.serverId, { costBasis: n });
              }}
              className="w-full rounded-lg border border-edge bg-black/40 py-2.5 pl-6 pr-3 text-sm text-white outline-none transition focus:border-brand-400"
            />
          </div>
        </label>
      </div>

      {!pricingOnly && <ListingCopyFields item={item} generated={generated} listing={listing} onChange={onChange} />}
      </>
      )}

      {verified && !pricingOnly && (
        <EbayPostActions
          item={item}
          listing={listing}
          price={price}
          ebayConnected={ebayConnected}
          onChange={onChange}
        />
      )}
    </div>
  );
}
