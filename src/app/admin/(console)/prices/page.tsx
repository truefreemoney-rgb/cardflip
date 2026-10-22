import { ago, money, num } from "@/components/admin/format";
import PriceCallButtons from "@/components/admin/PriceCallButtons";
import PostCheckRow from "@/components/admin/PostCheckRow";
import { postSlots, type PostSlot } from "@/lib/server/postCheck";
import { requireOwnerPage } from "@/lib/server/adminPage";
import { askCounts, lastRefereeRun, listAsks, type AskListRow } from "@/lib/server/ebayReferee";
import { db } from "@/lib/db";
import { listPriceReports, reportLabel, type PriceReportRow } from "@/lib/server/priceReports";
import { MANUAL_BAND } from "@/lib/server/priceTrustSite";
import { RAW_ONLY_TERMS, RAW_SOLD_QUERY } from "@/lib/listing";

export const dynamic = "force-dynamic";

const GAME_LABEL: Record<string, string> = { pokemon: "Pokémon", mtg: "Magic", lorcana: "Lorcana", onepiece: "One Piece", yugioh: "Yu-Gi-Oh!" };

/** eBay sold listings for the row's printing: the referee's own search, plus the finish word it cannot leave out. */
function soldUrl(r: AskListRow): string {
  const finish = r.variant === "foil" || r.variant === "etched" ? " foil" : r.variant === "reverseHolofoil" ? " reverse holo" : r.variant.startsWith("1stEdition") ? " 1st edition" : "";
  // Rows from a hand call carry no referee query: search the card's name and set from its label instead of nothing.
  const query = r.query || r.label.split(" | ").slice(0, 2).join(" ");
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${query}${finish} ${RAW_ONLY_TERMS}`)}&_sacat=183454&${RAW_SOLD_QUERY}`;
}

type CatalogRun = {
  at: number;
  failed: string[];
  games: Record<string, { cards: number; noOwnPicture: number; standIns?: number }>;
  /** Cards still showing another printing's picture 14+ days after release (FYI: retried nightly, no chore). */
  borrowing?: { game: string; name: string; set: string; released: string }[];
  /** Added on read: no run in over 36 h (the PC was off or the task failed to start). */
  stale?: boolean;
};
/** The PC's nightly catalog run (scripts/catalog-sync.cmd -> catalog-nightly-record.mjs), null before the first one. */
async function lastCatalogRun(): Promise<CatalogRun | null> {
  try {
    const row = (await db.prepare("SELECT value FROM price_history_meta WHERE key = 'catalog_nightly'").get()) as { value: string } | undefined;
    if (!row) return null;
    const run = JSON.parse(row.value) as CatalogRun;
    return { ...run, stale: Date.now() - run.at > 36 * 3600_000 };
  } catch {
    return null;
  }
}
/**
 * The cards of today's and tomorrow's three videos (10-18): check each against eBay SOLD before it posts. No automatic
 * rule can (docs/research/post-price-catch-2026-10-18.md). Slots already posted fold away.
 */
function PostCards({ slots }: { slots: PostSlot[] }) {
  const open = slots.filter((s) => !s.past && s.cards.length > 0);
  const left = open.reduce((n, s) => n + s.cards.filter((c) => c.status === "unchecked").length, 0);
  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold text-white">
        Post cards <span className="text-sm font-normal text-zinc-500">({left ? `${num(left)} to check` : "all checked"})</span>
      </h2>
      <p className="mb-2 text-xs text-zinc-500">
        Open eBay sold for each card. Near the price: Looks right. Off by more than about a quarter: type what it sold for and Fix. The price is fixed
        everywhere, posts show the card at that price with no % change (price-change posts skip it for 30 days), and the video is remade.
      </p>
      {open.length === 0 ? (
        <p className="rounded-2xl border border-edge bg-surface-1 px-4 py-3 text-sm text-zinc-500">No videos waiting to post.</p>
      ) : (
        <div className="space-y-3">
          {open.map((s) => (
            <div key={`${s.day}|${s.slot}`} className="rounded-2xl border border-edge bg-surface-1">
              <p className="border-b border-white/5 px-4 py-2 text-sm text-zinc-300">
                <span className="font-medium text-white">{s.label}</span> {s.title ? `· ${s.title}` : ""}
              </p>
              <ul className="divide-y divide-white/5 text-sm">
                {s.cards.map((c) => (
                  <PostCheckRow key={`${c.game}|${c.cardId}|${c.variant}`} day={s.day} slot={s.slot} past={s.past} {...c} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Readers' "Price looks wrong?" votes (A-H #9): the card page, which way, and an eBay sold search for its name. */
function ReaderTable({ rows }: { rows: PriceReportRow[] }) {
  if (rows.length === 0) return <p className="rounded-2xl border border-edge bg-surface-1 px-4 py-3 text-sm text-zinc-500">No reader has flagged a price yet.</p>;
  return (
    <ul className="divide-y divide-white/5 rounded-2xl border border-edge bg-surface-1 text-sm">
      {rows.map((r) => {
        const l = reportLabel(r.path);
        const finish = r.variant === "foil" || r.variant === "etched" ? " foil" : r.variant === "reverseHolofoil" ? " reverse holo" : r.variant.startsWith("1stEdition") ? " 1st edition" : "";
        const sold = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${l.name} ${l.set.replace(/-/g, " ")}${finish} ${RAW_ONLY_TERMS}`)}&_sacat=183454&${RAW_SOLD_QUERY}`;
        return (
          <li key={`${r.path}|${r.variant}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
            <a href={r.path} target="_blank" rel="noreferrer" className="font-medium text-white hover:underline">
              {l.name}
            </a>
            <span className="text-xs text-zinc-500">
              {GAME_LABEL[l.game] ?? l.game} · {l.set} · {r.variant}
            </span>
            <span className="tabular-nums text-white">{r.price != null ? money(r.price) : "no price"}</span>
            <span className="text-xs text-zinc-300">
              {[r.high ? `${num(r.high)} too high` : "", r.low ? `${num(r.low)} too low` : ""].filter(Boolean).join(" · ")} · {ago(r.last)}
            </span>
            <a href={sold} target="_blank" rel="noreferrer" className="text-xs font-medium text-sky-300 hover:underline">
              eBay sold
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Today's stored price, the one the pages judge and a call binds to (10-21, TASKS B.8); the referee's read (days old) goes
 * under it when it differs. A call stops binding once today's price is more than 10% off the price it was made at.
 */
function priceNow(r: AskListRow): { shown: number; read: number | null; lapsed: boolean } {
  const shown = r.today ?? r.price;
  const read = r.today != null && Math.abs(r.today - r.price) > 0.005 * r.price ? r.price : null;
  const lapsed = !!r.manual && r.manualPrice != null && r.manualPrice > 0 && Math.abs(shown - r.manualPrice) > MANUAL_BAND * r.manualPrice;
  return { shown, read, lapsed };
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
          {rows.map((r) => {
            const p = priceNow(r);
            return (
              <tr key={`${r.game}|${r.cardId}|${r.variant}`} className="border-b border-white/5 align-top last:border-0">
                <td className="px-4 py-3">
                  <span className="font-medium text-white">{r.label}</span>
                  <span className="block text-xs text-zinc-500">
                    {GAME_LABEL[r.game] ?? r.game}
                    {r.reason ? ` · ${r.reason}` : ""}
                    {r.manual ? ` · you said ${r.manual === "hide" ? "wrong" : "right"} at ${money(r.manualPrice ?? r.price)}` : ""}
                    {p.lapsed ? <span className="text-amber-300"> · no longer binds, today&apos;s price moved over 10%</span> : null}
                  </span>
                  {/* Phone: the other columns fold in under the name. */}
                  <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 sm:hidden">
                    <span className="font-medium tabular-nums text-white">
                      {money(p.shown)}
                      {p.read != null ? <span className="ml-1 text-xs font-normal text-zinc-500">eBay read {money(p.read)}</span> : null}
                    </span>
                    <span className="text-xs text-zinc-400">{r.median != null ? `eBay ${money(r.median)} mid · ${money(r.q75 ?? r.median)} upper` : "none listed on eBay"}</span>
                    <a href={soldUrl(r)} target="_blank" rel="noreferrer" className="text-xs font-medium text-sky-300 hover:underline">eBay sold</a>
                    <PriceCallButtons game={r.game} cardId={r.cardId} variant={r.variant} manual={r.manual} />
                  </span>
                </td>
                <td className="hidden px-4 py-3 text-right font-medium tabular-nums text-white sm:table-cell">
                  {money(p.shown)}
                  {p.read != null ? <span className="block text-xs font-normal text-zinc-500">eBay read {money(p.read)}</span> : null}
                </td>
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
            );
          })}
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
  const [run, counts, check, high, manual, catalog, readers, posts] = await Promise.all([
    lastRefereeRun(),
    askCounts(),
    listAsks("check"),
    listAsks("high"),
    listAsks("manual"),
    lastCatalogRun(),
    listPriceReports(),
    postSlots(),
  ]);
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
              {Object.entries(catalog.games)
                .map(([g, v]) => {
                  const notes = [v.standIns ? `${num(v.standIns)} borrowing another printing` : "", v.noOwnPicture ? `${num(v.noOwnPicture)} no picture yet` : ""].filter(Boolean);
                  return `${GAME_LABEL[g] ?? g} ${num(v.cards)}${notes.length ? ` (${notes.join(", ")})` : ""}`;
                })
                .join(" · ")}
              {catalog.stale ? <span className="text-amber-300"> · no run in over a day, is the PC on?</span> : null}
            </>
          ) : (
            "no run yet."
          )}
        </p>
        {catalog?.borrowing?.length ? (
          <p className="mt-1 text-xs text-zinc-500">
            Still borrowing 2+ weeks after release (tried again every night):{" "}
            {catalog.borrowing.map((b) => `${b.name} (${GAME_LABEL[b.game] ?? b.game}, ${b.set})`).join(" · ")}
          </p>
        ) : null}
      </div>
      <PostCards slots={posts} />
      <div>
        <h2 className="mb-2 text-lg font-semibold text-white">
          Readers flagged <span className="text-sm font-normal text-zinc-500">({num(readers.length)}, &quot;Price looks wrong?&quot; on card pages, last 90 days)</span>
        </h2>
        <ReaderTable rows={readers} />
      </div>
      <div>
        <h2 className="mb-2 text-lg font-semibold text-white">
          Hand check<span className="text-sm font-normal text-zinc-500">({num(counts.check)}, shown on the site, 1.5x+ the typical eBay ask)</span>
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
