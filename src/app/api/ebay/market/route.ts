import { NextResponse } from "next/server";
import { fxStaleReason } from "@/lib/localPricing";
import { requireUser, AuthError } from "@/lib/server/auth";
import { sellerMarket } from "@/lib/server/ebayMarket";
import { getFxRates } from "@/lib/server/fx";

/**
 * Which eBay site this seller lists on, for the editors' "£3.99 on eBay UK"
 * line (docs/EBAY_COUNTRIES_PLAN.md). `local: false` = eBay US, everything as
 * before. The client only needs the site key, the account type (fee model)
 * and the rate; the server prices the real listing itself at push time.
 * `rate` is null when the rate is too old to price a listing (the server
 * would refuse it, so the UI must not promise a price).
 */
export async function GET() {
  try {
    const user = await requireUser();
    const { mp, account } = await sellerMarket(user.id);
    if (mp.key === "US") return NextResponse.json({ local: false });
    const fx = await getFxRates();
    const usable = !fxStaleReason(fx) && fx?.rates[mp.currency] ? fx.rates[mp.currency] : null;
    return NextResponse.json({
      local: true,
      key: mp.key,
      account,
      rate: usable,
      rateDate: fx?.date ?? null,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
