import { fmtDate, money, STATUS_STYLE } from "@/components/admin/format";
import { listAllCards } from "@/lib/server/cards";
import { listAllUsers } from "@/lib/server/users";
import { requireOwnerPage } from "@/lib/server/adminPage";

export const dynamic = "force-dynamic";

export default async function AdminCardsPage() {
  await requireOwnerPage();
  const [cards, users] = await Promise.all([listAllCards(60), listAllUsers()]);
  const userById = new Map(users.map((u) => [u.id, u]));
  return (
    <section>
      <h1 className="mb-3 text-2xl font-semibold text-white">Recent cards <span className="text-sm font-normal text-zinc-500">(latest {cards.length})</span></h1>
      <div className="overflow-x-auto rounded-2xl border border-edge bg-surface-1">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/5 text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-3 font-medium">Card</th>
              <th className="px-4 py-3 font-medium">Game</th>
              <th className="px-4 py-3 font-medium">Owner</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">eBay</th>
              <th className="px-4 py-3 text-right font-medium">Price</th>
              <th className="px-4 py-3 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => {
              const owner = userById.get(c.userId);
              const displayPrice = c.status === "sold" ? c.soldPrice : c.price;
              // A listing that ended without selling keeps status "listed"
              // with ebay_ended_at stamped (Inventory shows "Auction
              // ended"); this table read it as listed / live (09-06).
              const ended = c.status === "listed" && c.ebayEndedAt != null;
              const shownStatus = ended ? "ended" : c.status;
              return (
                <tr key={c.id} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-medium text-white">{c.cardName}</span>
                    <span className="ml-2 text-xs text-zinc-500">{c.setName} · {c.cardNumber}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-400">{c.game === "mtg" ? "Magic" : "Pokémon"}</td>
                  <td className="px-4 py-3 text-zinc-400">{owner?.name ?? "Unknown"}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[shownStatus]}`}>{shownStatus}</span></td>
                  <td className="px-4 py-3 text-xs">
                    {ended
                      ? <span className="text-amber-300">ended</span>
                      : c.status === "sold"
                        ? <span className="text-emerald-300">sold</span>
                        : c.ebayListingId
                          ? <span className="text-emerald-400">live</span>
                          : c.ebayOfferId
                            ? <span className="text-sky-300">draft</span>
                            : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-white">{money(displayPrice ?? 0)}</td>
                  <td className="px-4 py-3 text-zinc-500">{fmtDate(c.updatedAt)}</td>
                </tr>
              );
            })}
            {cards.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-zinc-500">No cards scanned yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
