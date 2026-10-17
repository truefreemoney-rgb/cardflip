import { NextResponse } from "next/server";
import { requireUser, AuthError, emailGate } from "@/lib/server/auth";
import {
  EbayNotConfiguredError,
  ebaySearchUrl,
  ebaySoldSearchUrl,
  fetchEbayComps,
  fetchEbaySoldComps,
  isEbayConfigured,
} from "@/lib/server/ebay";
import type { GradedInfo, PokemonCard } from "@/lib/types";
import { canBeFirstEdition, isFirstEditionCard } from "@/lib/listing";
import { recordPoint } from "@/lib/server/priceHistory";
import { englishCardById } from "@/lib/server/enCards";
import { mtgCardById } from "@/lib/server/mtgCards";
import { cachedEbayComps, compsIdentity } from "@/lib/server/ebayCompsCache";
import { parseGame } from "@/lib/games";
import { flagBlocks, hasFallback } from "@/lib/priceFlag";
import { dayBudgetSpent } from "@/lib/server/dayBudget";
import {
  LIMITS,
  RateLimitError,
  enforceRateLimit,
  rateLimitResponse,
} from "@/lib/server/rateLimit";

/** Live eBay lookups a day (cache misses only): a seller pricing a big binder stays far under the first. */
const COMPS_USER_DAILY = 200;
/** Under eBay's ~5,000 Browse calls a day for the whole keyset, leaving room for listing work. */
const COMPS_APP_DAILY = 4000;
class CompsBudgetError extends Error {}

/** The catalog row behind a client card id, or null when the catalog has none (or the lookup fails). */
async function catalogCard(card: PokemonCard): Promise<PokemonCard | null> {
  if (typeof card.id !== "string" || !card.id) return null;
  try {
    return parseGame(card.game) === "mtg"
      ? ((await mtgCardById(card.id))[0] ?? null)
      : ((await englishCardById(card.id)).cards[0] ?? null);
  } catch (err) {
    console.error("comps catalog lookup failed:", err);
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    // Spends eBay Browse calls: not for a signup that has not proven its inbox.
    const unconfirmed = emailGate(user);
    if (unconfirmed) return unconfirmed;
    enforceRateLimit(`comps:${user.id}`, ...LIMITS.ebayComps);
    const body = await req.json().catch(() => null);
    const clientCard = body?.card as PokemonCard | undefined;

    if (typeof clientCard?.name !== "string" || !clientCard.name) {
      return NextResponse.json({ error: "Missing card" }, { status: 400 });
    }
    // The catalog, not the body, says what a card id is (compsIdentity).
    const { card, verified } = compsIdentity(clientCard, await catalogCard(clientCard));

    // Optional slab pricing: with a company+grade, the comps become
    // "what are copies at exactly this grade listed for".
    const grading =
      typeof body?.grading?.company === "string" && typeof body?.grading?.grade === "string"
        ? { company: String(body.grading.company).slice(0, 10), grade: String(body.grading.grade).slice(0, 20) }
        : null;

    // Both links work without any API access, so the UI can always point the
    // seller at eBay even when we have no credentials to price against.
    // 1st Edition is a separate market (Chris, 09-04): only meaningful for
    // sets that had a 1st Edition run; elsewhere the flag is ignored.
    // The twin card IS the stamped copy; the plain card of a set that had a
    // run is the unstamped one unless the seller ticked the stamp — a 1st
    // Edition slab must never land in the plain card's graded curve (09-29).
    const firstEdition = !canBeFirstEdition(card)
      ? null
      : isFirstEditionCard(card)
        ? true
        : typeof body?.firstEdition === "boolean"
          ? (body.firstEdition as boolean)
          : false;

    // A slab's links search its own grade; a raw card's leave slabs out (RAW_ONLY_TERMS).
    const linkFacts = { firstEdition: firstEdition === true, grading: grading as GradedInfo | null };
    const searchUrl = ebaySearchUrl(card, linkFacts);
    const soldSearchUrl = ebaySoldSearchUrl(card, linkFacts);

    if (!isEbayConfigured()) {
      return NextResponse.json({
        status: "unconfigured",
        comps: null,
        sold: null,
        soldStatus: "unconfigured",
        searchUrl,
        soldSearchUrl,
      });
    }

    // Sold data (Marketplace Insights) was DENIED by eBay on 2026-08-16 —
    // "highly limited, reserved for approved partners". The call stays behind
    // EBAY_INSIGHTS_ENABLED=1 in case that ever changes; by default we don't
    // spend a request on it per scan, and the UI shows the "View sold on
    // eBay" link instead. Settled independently so a sold failure never
    // sinks the active comps.
    const [activeResult, soldResult] = await Promise.allSettled([
      // One Browse call per card per day (lib/server/ebayCompsCache.ts).
      // Only a cache miss reaches eBay, so only a miss spends budget (10-01 sweep: a fresh made-up card name per request
      // was a miss every time, and one account could drain the app-wide Browse quota every seller prices from).
      cachedEbayComps(card, grading, firstEdition, async () => {
        if ((await dayBudgetSpent(`comps_${user.id}`, COMPS_USER_DAILY)) || (await dayBudgetSpent("comps_all", COMPS_APP_DAILY))) {
          throw new CompsBudgetError();
        }
        return fetchEbayComps(card, grading, firstEdition);
      }),
      process.env.EBAY_INSIGHTS_ENABLED === "1"
        ? fetchEbaySoldComps(card)
        : Promise.reject(new Error("Marketplace Insights not enabled")),
    ]);

    if (activeResult.status === "rejected") throw activeResult.reason;
    const { cached } = activeResult.value;
    let { comps } = activeResult.value;

    // A slab never sells below a raw copy of the same card. When the graded
    // average does, the comps are another printing (09-29: Celebrations
    // "4/102" slabs priced Base Set Charizard PSA 10 at $629 vs $944 raw) —
    // no price beats a wrong one, and it never enters the history.
    // A raw market the price guard flagged (untrusted) is not a floor to hold real slab sales against;
    // a flag with a fallback (10-17) floors at its fallback, only a flag with none is skipped.
    const rawMarket = Math.max(0, ...(card.prices ?? []).filter((p) => p.currency === "USD" && !flagBlocks(p.untrusted)).map((p) => (hasFallback(p.untrusted) ? p.untrusted.fallback : (p.market ?? 0))));
    if (grading && comps && rawMarket > 0 && comps.average < rawMarket) {
      console.warn(`graded comps below raw for ${card.id}: ${grading.company} ${grading.grade} ${comps.average} < ${rawMarket}`);
      comps = null;
    }

    // Graded lookups are the only graded price signal anywhere — bank each
    // one as a history point (variant "graded-psa-10" style) so cards people
    // actually price grow a REAL graded curve over time, replacing the
    // chart's rescaled estimate. Fire-and-forget: recording must never sink
    // the lookup.
    // Only a catalog card gets a series, searched under the catalog's own
    // name, so a hand-rolled body can't seed junk history rows.
    if (!cached && verified && grading && comps && comps.count >= 2) {
      const gradeNum = grading.grade.match(/\d+(?:\.\d+)?/)?.[0] ?? grading.grade;
      const variant = `graded-${grading.company.toLowerCase()}-${gradeNum}`;
      void recordPoint(card.id, parseGame(card.game), variant, "ebay", "USD", comps.average).catch((err) =>
        console.error("graded history point failed:", err),
      );
    }

    let sold = null;
    let soldStatus: "done" | "empty" | "unavailable" = "empty";
    if (soldResult.status === "fulfilled") {
      sold = soldResult.value;
      soldStatus = sold ? "done" : "empty";
    } else {
      soldStatus = "unavailable";
      // Only worth a log line when we actually asked eBay and it refused.
      if (process.env.EBAY_INSIGHTS_ENABLED === "1") {
        console.error("eBay sold comps unavailable:", soldResult.reason);
      }
    }

    return NextResponse.json({
      status: comps ? "done" : "empty",
      comps,
      cached,
      sold,
      soldStatus,
      searchUrl,
      soldSearchUrl,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof RateLimitError) return rateLimitResponse(err);
    if (err instanceof EbayNotConfiguredError) {
      return NextResponse.json({ status: "unconfigured", comps: null, sold: null });
    }
    if (err instanceof CompsBudgetError) {
      return NextResponse.json(
        { status: "error", error: "Today's eBay lookups are used up — try again tomorrow", comps: null, sold: null, retryAfterSeconds: 3600 },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }
    // An eBay outage shouldn't fail the scan — the card still prices off its
    // other sources, and the UI degrades to just the "view on eBay" links.
    console.error("eBay comps lookup failed:", err);
    return NextResponse.json(
      { status: "error", comps: null, sold: null },
      { status: 502 },
    );
  }
}
