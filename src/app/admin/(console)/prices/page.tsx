import { ago, money, num } from "@/components/admin/format";
import PriceCallButtons from "@/components/admin/PriceCallButtons";
import { requireOwnerPage } from "@/lib/server/adminPage";
import { askCounts, lastRefereeRun, listAsks, type AskListRow } from "@/lib/server/ebayReferee";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const GAME_LABEL: Record<string, string> = { pokemon: "Pokémon", mtg: "Magic", lorcana: "Lorcana", onepiece: "One Piece", yugioh: "Yu-Gi-Oh!" };

/** eBay sold listings for the row's printing: the referee's own search, plus the finish word it cannot leave out. */
function soldUrl(r: AskListRow): string {
  const finish = r.variant === "foil" || r.variant === "etched" ? " foil" : r.variant === "reverseHolofoil" ? " reverse holo" : r.variant.startsWith("1stEdition") ? " 1st edition" : "";
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(r.query + finish)}&LH_Sold=1&LH_Complete=1`;
}

type CatalogRun = { at: number; failed: string[]; games: Record<string, { cards: number; noOwnPicture: number }> };
/** The PC's nightly catalog run (scripts/catalog-sync.cmd -> catalog-nightly-record.mjs), null before the first one. */
async function lastCatalogRun(): Promise<CatalogRun | null> {
  try {
    const row = (await db.prepare("SELECT value FROM price_history_meta WHERE key = 'catalog_nightly'").get()) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as CatalogRun) : null;
  } catch {
    return null;
  }
}
function Table({ rows, empty }: { rows: AskListRow[]; empty: string }) {
  if (rows.length === 0) return <p className="rounded-2xl border border-edge bg-surface-1 px-4 py-3 text-sm text-zinc-500">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-edge bg-surface-1">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/5 text-xs uppercase tracking-wide text-zinc-500">
            <th className="px-4 py-3 font-medium">Card</th>
            <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">Our price</th>
            <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">eBay asks</th>
            <th className="hidden px-4 py-3 font-medium sm:table-cell">Check</th>
            <th className="hidden px-4 py-3 font-medium sm:table-cell">Call</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.game}|${r.cardId}|${r.variant}`} className="border-b border-white/5 align-top last:border-0">
              <td className="px-4 py-3">
                <span className="font-medium text-white">{r.label}</span>
                <span className="block text-xs text-zinc-500">
                  {GAME_LABEL[r.game] ?? r.game}
                  {r.reason ? ` · ${r.reason}` : ""}
                  {r.manual ? ` · you said ${r.manual === "hide" ? "wrong" : "right"} at ${money(r.manualPrice ?? r.price)}` : ""}
                </span>
                {/* Phone: the other columns fold in under the name. */}
                <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 sm:hidden">
                  <span className="font-medium tabular-nums text-white">{money(r.price)}</span>
                  <span className="text-xs text-zinc-400">{r.median != null ? `eBay ${money(r.median)} mid · ${money(r.q75 ?? r.median)} upper` : "none listed on eBay"}</span>
                  <a href={soldUrl(r)} target="_blank" rel="noreferrer" className="text-xs font-medium text-sky-300 hover:underline">eBay sold</a>
                  <PriceCallButtons game={r.game} cardId={r.cardId} variant={r.variant} manual={r.manual} />
                </span>
              </td>
              <td className="hidden px-4 py-3 text-right font-medium tabular-nums text-white sm:table-cell">{money(r.price)}</td>
              <td className="hidden px-4 py-3 text-right tabular-nums text-zinc-400 sm:table-cell">
                {r.median != null ? (
                  <>
                    {money(r.median)} <span className="text-zinc-600">mid</span>
                    <span className="block text-xs">
                      {money(r.q75 ?? r.median)} upper · {num(r.nNm)} listed
                    </span>
                  </>
                ) : (
                  <span className="text-zinc-600">none listed</span>
                )}
              </td>
              <td className="hidden px-4 py-3 sm:table-cell">
                <a href={soldUrl(r)} target="_blank" rel="noreferrer" className="text-xs font-medium text-sky-300 hover:underline">
                  eBay sold
                </a>
              </td>
              <td className="hidden px-4 py-3 sm:table-cell">
                <PriceCallButtons game={r.game} cardId={r.cardId} variant={r.variant} manual={r.manual} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Price checks (10-13): the nightly eBay referee's work. "Hidden by eBay" = the
 * price is far above every eBay ask for the printing, so the site shows "price
 * looks off" instead; "Hand check" = 1.5x+ the typical ask, shown but doubtful.
 * Asks are not sales: check eBay SOLD, then call it right or wrong.
 */
export default async function AdminPricesPage() {
  await requireOwnerPage();
  const [run, counts, check, high, manual, catalog] = await Promise.all([lastRefereeRun(), askCounts(), listAsks("check"), listAsks("high"), listAsks("manual"), lastCatalogRun()]);
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Price checks</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Every $100+ card is compared with its eBay listings about once a week.{" "}
          {run ? (
            <>
              Last run {ago(run.at)}: {num(run.read)} read, {num(run.calls)} eBay calls, {num(run.left)} waiting
              {run.failed ? `, ${num(run.failed)} failed` : ""}
              {run.skipped ? ` (skipped: ${run.skipped})` : ""}.
            </>
          ) : (
            "No run yet."
          )}{" "}
          This week: {num(counts.ok)} fine, {num(counts.check)} to check, {num(counts.high)} hidden, {num(counts.none)} not on eBay, {num(counts.manual)} called by you.
        </p>
        <p className="mt-1 text-sm text-zinc-400">
          New cards (your PC, nightly 2am):{" "}
          {catalog ? (
            <>
              last run {ago(catalog.at)}
              {catalog.failed.length ? <span className="text-amber-300"> · failed: {catalog.failed.join(", ")}</span> : " · all steps fine"}
              {" · "}
              {Object.entries(catalog.games).map(([g, v]) => `${GAME_LABEL[g] ?? g} ${num(v.cards)}${v.noOwnPicture ? ` (${num(v.noOwnPicture)} no picture yet)` : ""}`).join(" · ")}
              {Date.now() - catalog.at > 36 * 3600_000 ? <span className="text-amber-300"> · no run in over a day, is the PC on?</span> : null}
            </>
          ) : (
            "no run yet."
          )}
        </p>
      </div>
      <div>
        <h2 className="mb-2 text-lg font-semibold text-white">
          Hand check <span className="text-sm font-normal text-zinc-500">({num(counts.check)}, shown on the site, 1.5x+ the typical eBay ask)</span>
        </h2>
        <Table rows={check} empty="Nothing to check." />
      </div>
      <div>
        <h2 className="mb-2 text-lg font-semibold text-white">
          Hidden by eBay <span className="text-sm font-normal text-zinc-500">({num(counts.high)}, the site says the price looks off)</span>
        </h2>
        <Table rows={high} empty="Nothing hidden." />
      </div>
      <div>
        <h2 className="mb-2 text-lg font-semibold text-white">
          Your calls <span className="text-sm font-normal text-zinc-500">({num(counts.manual)})</span>
        </h2>
        <Table rows={manual} empty="No calls yet." />
      </div>
    </section>
  );
}
