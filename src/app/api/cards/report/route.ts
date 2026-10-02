import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { listCardsForUser } from "@/lib/server/cards";
import { csvCell, saleBreakdown, saleYear, yearTotals } from "@/lib/profit";

/**
 * Year-end sales report as CSV (09-27): one row per sale in the year, then
 * a totals row. What a seller hands an accountant or pastes into a
 * spreadsheet at tax time. Fees are the actual eBay figure when recorded,
 * else the estimate, and the row says which. GET /api/cards/report?year=2026
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const year = Number(url.searchParams.get("year"));
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      return NextResponse.json({ error: "year must be a four-digit year" }, { status: 400 });
    }
    const cards = await listCardsForUser(user.id);
    const sales = cards
      .filter((c) => c.status === "sold" && c.soldPrice != null && c.soldAt != null && saleYear(c.soldAt) === year)
      .sort((a, b) => a.soldAt! - b.soldAt!);
    const t = yearTotals(cards, year);

    const day = (ts: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(ts);
    const lines: string[] = [
      ["Sold on", "Card", "Set", "Number", "Condition", "Sold for", "eBay fees", "Fees are", "Postage", "What you paid", "Profit", "eBay order"].map(csvCell).join(","),
    ];
    for (const c of sales) {
      const b = saleBreakdown(c)!;
      lines.push(
        [
          day(c.soldAt!),
          c.cardName,
          c.setName,
          c.cardNumber,
          c.condition,
          b.gross,
          b.fees,
          b.byHand ? "none (marked by hand)" : b.feesActual ? "actual" : "estimated",
          b.postage,
          b.costKnown ? b.cost : "",
          b.profit,
          c.ebayOrderId ?? "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
    lines.push("");
    lines.push(["Total", `${t.sales} sales`, "", "", "", t.gross, t.fees, t.feesEstimated ? `${t.feesEstimated} estimated` : "all actual", t.postage, t.cost, t.profit, ""].map(csvCell).join(","));
    if (t.costMissing) lines.push(["", `${t.costMissing} sale${t.costMissing === 1 ? "" : "s"} ${t.costMissing === 1 ? "has" : "have"} no purchase price entered; profit for those is before cost.`].map(csvCell).join(","));
    lines.push(["", "Fees are eBay's actual final value fee where CardFlip has synced it, otherwise 13.25% + $0.30 per order ($0.40 over $10). Postage is a flat allowance per sale. A sale marked by hand carries no eBay fee and no postage. Check both against your own records."].map(csvCell).join(","));

    return new NextResponse(lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="cardflip-sales-${year}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}
