import DailyJobControl from "@/components/admin/DailyJobControl";
import { bytes, fmtDate, num } from "@/components/admin/format";
import { getAdminOverview } from "@/lib/server/adminStats";

export const dynamic = "force-dynamic";

export default async function AdminDataPage() {
  const o = await getAdminOverview();
  return (
    <section>
      <h1 className="mb-3 text-2xl font-semibold text-white">Prices &amp; data</h1>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border border-edge bg-surface-1 p-4 lg:col-span-2">
          <p className="mb-3 text-sm font-medium text-zinc-200">Daily price refresh</p>
          <DailyJobControl initial={o.data.daily} now={Date.now()} />
        </div>
        <div className="rounded-2xl border border-edge bg-surface-1 p-4">
          <p className="mb-3 text-sm font-medium text-zinc-200">Price history</p>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-zinc-500">Series total</dt><dd className="text-right tabular-nums text-white">{num(o.data.priceSeries.total)}</dd>
            <dt className="text-zinc-500">Pokémon</dt><dd className="text-right tabular-nums text-zinc-300">{num(o.data.priceSeries.pokemon)}</dd>
            <dt className="text-zinc-500">Magic</dt><dd className="text-right tabular-nums text-zinc-300">{num(o.data.priceSeries.mtg)}</dd>
            <dt className="text-zinc-500">Latest point</dt><dd className="text-right text-zinc-300">{o.data.priceSeries.latestDay ?? "—"}</dd>
            <dt className="text-zinc-500">TCGplayer map</dt><dd className="text-right tabular-nums text-zinc-300">{num(o.data.tcgplayerMap)}</dd>
          </dl>
        </div>
        <div className="rounded-2xl border border-edge bg-surface-1 p-4">
          <p className="mb-3 text-sm font-medium text-zinc-200">Catalogue mirrors</p>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-zinc-500">Pokémon EN</dt><dd className="text-right tabular-nums text-zinc-300">{num(o.data.enCards)}</dd>
            <dt className="text-zinc-500">Pokémon JA / ZH</dt><dd className="text-right tabular-nums text-zinc-300">{num(o.data.jpCards)} / {num(o.data.zhCards)}</dd>
            <dt className="text-zinc-500">Magic printings</dt><dd className="text-right tabular-nums text-zinc-300">{num(o.data.mtgCards)}</dd>
            <dt className="text-zinc-500">Magic sets</dt><dd className="text-right tabular-nums text-zinc-300">{num(o.data.mtgSets)}</dd>
            <dt className="text-zinc-500">Magic synced</dt><dd className="text-right text-zinc-300">{fmtDate(o.data.mtgSyncedAt)}</dd>
          </dl>
        </div>
        <div className="rounded-2xl border border-edge bg-surface-1 p-4 lg:col-span-2">
          <p className="mb-3 text-sm font-medium text-zinc-200">Storage</p>
          <dl className="grid grid-cols-2 gap-y-2 text-sm sm:grid-cols-4">
            <div><dt className="text-zinc-500">SQLite (incl. WAL)</dt><dd className="text-white">{bytes(o.data.dbBytes)}</dd></div>
            <div><dt className="text-zinc-500">Seed marker</dt><dd className="truncate text-zinc-300" title={o.data.seedMarker ?? ""}>{o.data.seedMarker ? `v${o.data.seedMarker.split(":v")[1] ?? "?"} · imported` : "not imported"}</dd></div>
            <div><dt className="text-zinc-500">Refresh cadence</dt><dd className="text-zinc-300">every ~20 h</dd></div>
            <div><dt className="text-zinc-500">Sources</dt><dd className="text-zinc-300">Scryfall bulk · TCGCSV · pokemontcg.io</dd></div>
          </dl>
        </div>
      </div>
    </section>
  );
}
