import { NextResponse } from "next/server";
import { fxStaleReason } from "@/lib/localPricing";
import { requireUser, AuthError } from "@/lib/server/auth";
import { getCardForUser } from "@/lib/server/cards";
import { quoteCardForSite, sellerMarket } from "@/lib/server/ebayMarket";
import { getFxRates } from "@/lib/server/fx";

/**
 * Which eBay site this seller lists on, and (with ?cardId=&strategy=) exactly
 * what pushing THAT card would list at there. `local: false` = eBay US,
 * everything as before. The `ask` comes from the same code the push runs
 * (ebayMarket.ts quoteCardForSite: marketFor + resolveLocalAsk), so the number
 * the editors and the confirm step show is by construction the number that is
 * sent to eBay. `askError` carries the plain-language reason when the server
 * would refuse (stale rate, no trusted or too-old market price).
 * `rate` is null when the rate is too old to price a listing.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const { mp, account } = await sellerMarket(user.id);
    if (mp.key === "US") return NextResponse.json({ local: false });
    const url = new URL(req.url);
    const cardId = url.searchParams.get("cardId");
    const strategy = url.searchParams.get("strategy") === "quick" ? "quick" : "market";
    let ask: Awaited<ReturnType<typeof quoteCardForSite>> | null = null;
    if (cardId) {
      const card = await getCardForUser(cardId, user.id);
      if (card) ask = await quoteCardForSite(user.id, card, strategy);
    }

    const fx = await getFxRates();
    const usable = !fxStaleReason(fx) && fx?.rates[mp.currency] ? fx.rates[mp.currency] : null;
    return NextResponse.json({
      local: true,
      key: mp.key,
      account,
      rate: usable,
      rateDate: fx?.date ?? null,
      ...(ask && ask.local ? { ask } : {}),
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
