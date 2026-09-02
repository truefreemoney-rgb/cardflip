"use client";

import { useEffect, useState } from "react";
import Spinner from "@/components/Spinner";
import ListedPanel from "@/components/ListedPanel";
import SoldPanel from "@/components/SoldPanel";
import CardImage from "@/components/CardImage";
import MarketMetricsPanel from "@/components/MarketMetricsPanel";
import EbayPostActions from "@/components/EbayPostActions";
import ListingCopyFields from "@/components/ListingCopyFields";
import PriceInput from "@/components/PriceInput";
import { updateServerCard } from "@/lib/client/cardsApi";
import { fetchEbayComps } from "@/lib/client/ebayApi";
import { searchCards } from "@/lib/cards";
import { parseCardQuery } from "@/lib/cardNumber";
import { displayCardNumber, parseMtgQuery } from "@/lib/games";
import { addToWishlist } from "@/lib/client/wishlistApi";
import {
  CONDITIONS,
  buildListing,
  describeItemCondition,
  canBeFirstEdition,
  canPriceListing,
  effectiveVariant,
  firstEditionPrice,
  formatMoney,
  ebaySearchUrl,
  ebaySoldSearchUrl,
  isFirstEditionVariant,
  quoteForItem,
  quotePrice,
  withListingOverrides,
} from "@/lib/listing";
import { GRADING_COMPANIES, gradeLabel, gradesFor } from "@/lib/grading";
import { useLastRecordedPrice } from "@/components/PriceHistoryChart";
import { saveCondition, saveStrategy } from "@/lib/client/scanPrefs";
import type {
  Condition,
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
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

export default function CardEditor({ item, ebayConnected, onChange, onNext, onApplyConditionToAll }: Props) {
  const [term, setTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [wishlisted, setWishlisted] = useState(false);
  const [wishlisting, setWishlisting] = useState(false);

  const card = item.card;
  // Slab comps: what copies at exactly this grade are listed for on eBay.
  // Fetched when the seller sets/changes the grade — turns the "raw market
  // is only a floor" note into a real graded number (Chris, 09-02).
  const [gradedComps, setGradedComps] = useState<{ average: number; count: number } | null>(null);
  const [gradedCompsLoading, setGradedCompsLoading] = useState(false);
  const gradeKey = item.grading ? `${item.grading.company}:${item.grading.grade}:${card?.id ?? ""}` : "";
  useEffect(() => {
    setGradedComps(null);
    if (!gradeKey || !card || !item.grading) return;
    let stale = false;
    setGradedCompsLoading(true);
    void fetchEbayComps(card, item.grading).then((res) => {
      if (stale) return;
      setGradedCompsLoading(false);
      if (res.comps && res.comps.count >= 2) {
        setGradedComps({ average: res.comps.average, count: res.comps.count });
      }
    });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradeKey]);

  // Hook, so it lives above the early returns (empty id = no fetch). The
  // chart's current-day point drives the quote when it's allowed to (see
  // pointCanRebase in lib/listing.ts) — the Market tile and the price history
  // must not tell the seller two different "today" numbers (Chris, 09-01).
  const currentPoint = useLastRecordedPrice(card?.id ?? "", effectiveVariant(item) ?? null);

  async function runSearch() {
    if (!term.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      // "Charizard 4/102" — the number the seller can see is the fastest way
      // to correct a wrong match, so accept it alongside the name.
      let found;
      if (item.game === "mtg") {
        const { name, number, setCode } = parseMtgQuery(term);
        const printed = number || setCode ? { number: number ?? "", setTotal: null, setCode, isSecretRare: false } : null;
        found = await searchCards(name, printed, item.language, undefined, "mtg");
      } else {
        const { name, printed } = parseCardQuery(term);
        found = await searchCards(name, printed, item.language);
      }
      if (found.length === 0) {
        setSearchError("No cards matched that search.");
      } else {
        onChange({
          candidates: found,
          card: found[0],
          status: found.length === 1 ? "ready" : "review",
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
            the same photo (lookups flake), swap in a better shot, or fall
            through to the name search below. The page re-pumps whenever an
            item returns to "queued". */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {item.file && (
            <button
              onClick={() =>
                onChange({ status: "queued", error: null, visionStatus: "idle", vision: null })
              }
              className="rounded-full bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200"
            >
              Scan again
            </button>
          )}
          <label className="cursor-pointer rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-edge-strong hover:bg-surface-2">
            Use a different photo
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (item.previewUrl.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
                onChange({
                  file,
                  previewUrl: URL.createObjectURL(file),
                  status: "queued",
                  error: null,
                  vision: null,
                  visionStatus: "idle",
                });
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {manualSearch}
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
  const firstEdPrice = firstEdEligible ? firstEditionPrice(card) : null;

  const variant = effectiveVariant(item);
  const quote = quoteForItem(item, currentPoint);
  const quickQuote = quotePrice(card, item.condition, "quick", variant, currentPoint);
  const marketQuote = quotePrice(card, item.condition, "market", variant, currentPoint);

  const facts = { firstEdition: item.firstEdition, grading: item.grading };

  // Grade/condition changes reach the ledger immediately, not just at the
  // listed/sold checkpoint (Chris, 09-01: graded cards matter — a resumed
  // draft must come back as the slab it is, and My Cards shouldn't call a
  // PSA 10 "Near Mint"). The ledger's condition string is the one source:
  // "PSA 10" for slabs, the raw scale otherwise; resume parses it back.
  function syncLedgerCondition(next: Partial<ScanItem>) {
    if (!item.serverId) return;
    void updateServerCard(item.serverId, {
      condition: describeItemCondition({ ...item, ...next } as ScanItem),
    });
  }
  const price = item.priceOverride ?? quote?.suggested ?? 0;
  const generated = buildListing(
    card,
    price,
    item.condition,
    quote?.price.label,
    facts,
  );
  const listing = withListingOverrides(generated, item);
  // This dropdown chooses what the dollar asking price is derived from, so it
  // only offers prices that can actually serve as that basis — a euro figure
  // picked here would silently become a dollar listing price. On eligible
  // WotC-era cards the 1st Edition rows are owned by the toggle instead, so
  // the two controls can't contradict each other.
  const pricedVariants = card.prices.filter(
    (p) =>
      p.market &&
      p.market > 0 &&
      canPriceListing(p) &&
      !(firstEdEligible && isFirstEditionVariant(p.variant)),
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
    <div className="flex h-full flex-col gap-6 p-6 sm:p-8 lg:overflow-y-auto">
      <div className="flex flex-col gap-5 sm:flex-row">
        {/* The seller's photo stays beside the match. Showing only the matched
            card's official art made a wrong match invisible — there was
            nothing left to compare it against. */}
        <div className="flex shrink-0 items-start gap-3">
          <div>
            <CardImage
              src={card.imageLarge || card.imageSmall || item.previewUrl}
              alt={card.name}
              className="h-56 w-auto rounded-xl shadow-2xl shadow-black/50"
            />
            <p className="mt-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-zinc-600">
              Match
            </p>
          </div>
          {/* Search-added cards have no photo — nothing to compare against. */}
          {item.previewUrl && (
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.previewUrl}
                alt="The photo you uploaded"
                className="h-56 w-auto rounded-xl object-contain opacity-90 shadow-xl shadow-black/40"
              />
              <p className="mt-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-zinc-600">
                Your photo
              </p>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold text-white">
            {card.englishName || card.name}
            {/* The printed name stays visible when it differs -- it is how
                the physical card in hand is verified against the match. */}
            {card.englishName && card.englishName !== card.name && (
              <span className="ml-2 text-base font-normal text-zinc-500">{card.name}</span>
            )}
          </h2>
          {card.englishName && (
            <p className="text-base font-medium text-brand-300">
              {card.englishName}
            </p>
          )}
          <p className="mt-0.5 text-base text-zinc-400">
            {card.setName} · {displayCardNumber(card)}
            {card.isSecretRare ? " · Secret rare" : ""}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {card.rarity && (
              <span className="rounded-full bg-brand-500/10 px-3 py-1 text-sm font-medium text-brand-300">
                {card.rarity}
              </span>
            )}
            {item.grading && (
              <span className="rounded-full bg-sky-400/10 px-3 py-1 text-sm font-medium text-sky-300">
                {gradeLabel(item.grading)}
              </span>
            )}
            {quote &&
              // An eBay-asking basis ("eBay asking (57 listings)") is built
              // from a real search — link the chip to those listings so the
              // seller can eyeball what the average is made of.
              (/^eBay/i.test(quote.price.label) ? (
                <a
                  // Restored queue items can lose the comps object but keep
                  // the eBay-asking label; the local URL builder is the same
                  // search, so the chip always links.
                  href={item.ebay?.searchUrl ?? ebaySearchUrl(card, facts)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full bg-white/5 px-3 py-1 text-sm text-zinc-400 underline decoration-zinc-600 underline-offset-2 transition hover:bg-white/10 hover:text-zinc-200"
                >
                  Market {formatMoney(quote.base, quote.price.currency)} ·{" "}
                  {quote.price.label} ↗
                </a>
              ) : (
                <span className="rounded-full bg-white/5 px-3 py-1 text-sm text-zinc-400">
                  Market {formatMoney(quote.base, quote.price.currency)} ·{" "}
                  {quote.price.label}
                </span>
              ))}
            {/* The road to other sellers' listings must survive the pricing
                basis: since the current-day rebase (09-01) the Market chip is
                usually a TCGplayer point, which took the eBay link and count
                with it (Chris). When the Market chip isn't the eBay one,
                this chip is. */}
            {quote && !/^eBay/i.test(quote.price.label) && (
              item.ebay && item.ebay.count > 0 ? (
                <a
                  href={item.ebay.searchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full bg-white/5 px-3 py-1 text-sm text-zinc-400 underline decoration-zinc-600 underline-offset-2 transition hover:bg-white/10 hover:text-zinc-200"
                >
                  eBay asking {formatMoney(item.ebay.average, "USD")} · {item.ebay.count} listing
                  {item.ebay.count === 1 ? "" : "s"} ↗
                </a>
              ) : (
                <a
                  href={ebaySearchUrl(card, facts)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full bg-white/5 px-3 py-1 text-sm text-zinc-400 underline decoration-zinc-600 underline-offset-2 transition hover:bg-white/10 hover:text-zinc-200"
                >
                  See eBay listings ↗
                </a>
              )
            )}
            {item.visionStatus === "done" && item.vision && (
              <span className="rounded-full bg-brand-500/10 px-3 py-1 text-sm font-medium text-brand-300">
                Read from photo
                {item.vision.confidence < 0.5 ? " · low confidence" : ""}
              </span>
            )}
          </div>

          {/* The grade drives the price, so say what the photo showed rather
              than silently applying a multiplier the seller can't check. */}
          {item.vision?.conditionNotes && (
            <p className="mt-2 text-sm leading-snug text-zinc-500">
              <span className="font-medium text-zinc-400">
                Graded {item.vision.condition ?? "from photo"}:
              </span>{" "}
              {item.vision.conditionNotes}
            </p>
          )}

          <button
            onClick={handleWishlist}
            disabled={wishlisting || wishlisted}
            className={`mt-3 flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition disabled:cursor-default ${
              wishlisted
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-white/5 text-zinc-300 hover:bg-white/10"
            }`}
          >
            {wishlisting && <Spinner className="h-3 w-3" />}
            {wishlisted ? "★ Saved to watchlist" : "☆ Add to watchlist"}
          </button>

          {item.candidates.length > 1 && (
            <button
              onClick={() => setShowAlternatives((v) => !v)}
              className="mt-3 text-sm text-brand-300 underline underline-offset-4 hover:text-brand-200"
            >
              {showAlternatives
                ? "Hide other matches"
                : `Not this card? ${item.candidates.length - 1} other match${
                    item.candidates.length > 2 ? "es" : ""
                  }`}
            </button>
          )}

          {showAlternatives && (
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5">
              {item.candidates.map((c: PokemonCard) => (
                <button
                  key={c.id}
                  onClick={() => {
                    onChange({
                      card: c,
                      status: "ready",
                      priceOverride: null,
                      variant: null,
                      firstEdition: false,
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
                  <CardImage
                    src={c.imageSmall}
                    alt={`${c.name}, ${c.setName}`}
                    className="aspect-[5/7] w-full"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!quote && (
        <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          No market price is available for this card — set your own price below.
        </p>
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
          item.firstEdition || item.grading
            ? ebaySoldSearchUrl(card, facts)
            : (item.ebaySoldUrl ?? ebaySoldSearchUrl(card))
        }
        active={item.ebay}
        activeStatus={item.ebayStatus}
        activeUrl={ebaySearchUrl(card, facts)}
      />

      {firstEdEligible && (
        <div className="rounded-xl border border-edge bg-surface-1 p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={item.firstEdition}
              onChange={(e) =>
                onChange({
                  firstEdition: e.target.checked,
                  // The toggle owns the printing choice — a stale dropdown
                  // pick or manual price from the other printing would
                  // otherwise keep driving the quote.
                  variant: null,
                  priceOverride: null,
                })
              }
              className="mt-0.5 h-4 w-4 accent-brand-500"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-zinc-200">
                1st Edition stamp
                {firstEdPrice && (
                  <span className="ml-2 font-semibold text-brand-300">
                    {formatMoney(firstEdPrice.market, firstEdPrice.currency)}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-zinc-500">
                {card.setName} had a 1st Edition print run worth a premium —
                check the box if your card has the stamp by the artwork.
              </span>
            </span>
          </label>
          {item.firstEdition && !firstEdPrice && (
            <p className="mt-3 rounded-lg bg-amber-400/10 px-3 py-2 text-xs leading-snug text-amber-300">
              Our price source doesn&apos;t track 1st Edition {card.setName}{" "}
              separately, so the suggested price below is for the unlimited
              printing. 1st Edition copies sell for a large premium — check the
              eBay links above (they now search 1st Edition) and set your own
              price.
            </p>
          )}
        </div>
      )}


      <div className="grid gap-4 sm:grid-cols-2">
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
              value={item.condition}
              onChange={(e) => {
                const condition = e.target.value as Condition;
                onChange({ condition, priceOverride: null });
                syncLedgerCondition({ condition });
                // Remembered per browser — the next scanned card starts here.
                saveCondition(condition);
              }}
              className="rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-400"
            >
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
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

        {/* Hidden while 1st Edition is checked — the toggle owns the printing
            choice, and picking an unlimited row here would silently unprice
            the 1st Edition listing. */}
        {!item.firstEdition && pricedVariants.length > 1 && (
          <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
            Printing
            <select
              value={item.variant ?? quote?.price.variant ?? ""}
              onChange={(e) => onChange({ variant: e.target.value, priceOverride: null })}
              className="rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-400"
            >
              {pricedVariants.map((p) => (
                <option key={`${p.source}-${p.variant}`} value={p.variant}>
                  {p.label} — {formatMoney(p.market, p.currency)}
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

      {!item.grading && quickQuote && marketQuote && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-zinc-300">
            Pricing
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["quick", "Quick sale", quickQuote.suggested, "Undercuts market to move fast"],
                ["market", "Market price", marketQuote.suggested, "Holds out for full value"],
              ] as [PriceStrategy, string, number, string][]
            ).map(([value, label, amount, hint]) => (
              <button
                key={value}
                onClick={() => {
                  onChange({ strategy: value, priceOverride: null });
                  // Remembered per browser — the next scanned card starts here.
                  saveStrategy(value);
                }}
                className={`rounded-xl border p-3 text-left transition ${
                  item.strategy === value
                    ? "border-brand-400 bg-brand-500/10"
                    : "border-edge bg-surface-1 hover:border-edge-strong"
                }`}
              >
                <span className="block text-sm font-semibold text-white">
                  ${amount.toFixed(2)}
                </span>
                <span className="block text-xs text-zinc-400">{label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-zinc-600">
                  {hint}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <div className="grid grid-cols-[1fr_auto] gap-3">
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
                if (item.serverId) void updateServerCard(item.serverId, { price: n });
              }}
              className="w-full rounded-lg border border-edge bg-black/40 py-2.5 pl-6 pr-3 text-sm text-white outline-none transition focus:border-brand-400"
            />
          </div>
        </label>
        {/* Identical copies on one listing (per-copy price): eBay sells them
            down as one offer, and duplicate scans of the same card would
            otherwise trip eBay's duplicate-listing policy. */}
        <label className="flex w-24 flex-col gap-1.5 text-sm font-medium text-zinc-300">
          Copies
          <input
            type="number"
            min={1}
            max={99}
            step={1}
            value={item.quantity ?? 1}
            onChange={(e) => {
              const q = Math.min(99, Math.max(1, Math.floor(Number(e.target.value) || 1)));
              onChange({ quantity: q });
              if (item.serverId) void updateServerCard(item.serverId, { quantity: q });
            }}
            className="w-full rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-center text-sm text-white outline-none transition focus:border-brand-400"
          />
        </label>
      </div>

      <ListingCopyFields item={item} generated={generated} listing={listing} onChange={onChange} />

      <EbayPostActions
        item={item}
        listing={listing}
        price={price}
        ebayConnected={ebayConnected}
        onChange={onChange}
      />
    </div>
  );
}
