"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import GameToggle from "@/components/GameToggle";
import PriceInput from "@/components/PriceInput";
import PageSkeleton from "@/components/PageSkeleton";
import { useSession } from "@/components/SessionProvider";
import { toast } from "@/components/Toaster";
import { createPackRequest, fetchPacks, type PackLifetime, type PackSummary } from "@/lib/client/packsApi";
import { saveActivePackId } from "@/lib/client/scanPrefs";
import { GAMES, readSavedGame } from "@/lib/games";
import { formatMoney } from "@/lib/listing";
import { PACK_NAME_MAX, gainClass, roiLabel } from "@/lib/packs";
import { etDate } from "@/lib/time";
import type { GameId } from "@/lib/types";

export default function PacksPage() {
  const router = useRouter();
  const { user } = useSession();
  const [data, setData] = useState<{ packs: PackSummary[]; lifetime: PackLifetime } | null | undefined>(undefined);
  const [game, setGame] = useState<GameId>(readSavedGame);
  const [name, setName] = useState("");
  const [cost, setCost] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchPacks().then(setData);
  }, []);

  async function open() {
    if (busy) return;
    if (!name.trim()) {
      toast("Give the pack a name first", "err");
      return;
    }
    setBusy(true);
    const r = await createPackRequest({ game, name, cost });
    if (!r.pack) {
      setBusy(false);
      toast(r.error ?? "Couldn't open the pack", "err");
      return;
    }
    saveActivePackId(user?.id, r.pack.id);
    router.push("/app");
  }

  if (data === undefined) return <PageSkeleton variant="page" />;
  const life = data?.lifetime;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Packs</h1>
        <p className="mt-1 text-sm text-zinc-500">Open a pack, scan what you pull, see if it paid off.</p>
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-edge bg-surface-1 p-3">
        <h2 className="text-sm font-semibold text-white">Open a Pack</h2>
        <GameToggle game={game} onChange={setGame} block />
        <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
          Pack name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={PACK_NAME_MAX}
            placeholder={`Like "${game === "pokemon" ? "Surging Sparks booster" : `${GAMES[game].label} booster`}"`}
            className="w-full rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-400"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
          What you paid
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">$</span>
            <PriceInput
              value={cost}
              onValue={setCost}
              className="w-full rounded-lg border border-edge bg-black/40 py-2.5 pl-6 pr-3 text-sm text-white outline-none transition focus:border-brand-400"
            />
          </div>
        </label>
        <button
          type="button"
          onClick={() => void open()}
          disabled={busy}
          className="rounded-full bg-brand-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-60"
        >
          {busy ? "Opening…" : "Open Pack and Scan Pulls"}
        </button>
      </section>

      {life && life.packs > 0 && (
        <section className="rounded-xl border border-edge bg-surface-1 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">All Packs</p>
          <p className={`mt-1 text-2xl font-bold ${gainClass(life.profit)}`}>
            {life.profit < 0 ? "-" : life.profit > 0 ? "+" : ""}
            {formatMoney(Math.abs(life.profit))} <span className="text-base">({roiLabel(life.roiPct)})</span>
          </p>
          <p className="text-xs text-zinc-400">
            {life.packs} {life.packs === 1 ? "pack" : "packs"} · paid {formatMoney(life.cost)} · pulled {formatMoney(life.value)} · {life.cards} {life.cards === 1 ? "card" : "cards"}
          </p>
        </section>
      )}

      {data === null ? (
        <p className="text-sm text-zinc-400">Couldn&apos;t load your packs. Refresh to try again.</p>
      ) : data.packs.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {data.packs.map((p) => (
            <li key={p.id}>
              <Link href={`/app/packs/${p.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-surface-1 px-3 py-2.5 transition hover:border-brand-400">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{p.name}</p>
                  <p className="text-xs text-zinc-500">
                    {GAMES[p.game].label} · {etDate(p.createdAt)} · {p.count} {p.count === 1 ? "card" : "cards"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-sm font-bold ${gainClass(p.profit)}`}>{roiLabel(p.roiPct)}</p>
                  <p className="text-xs text-zinc-500">
                    {formatMoney(p.value)} for {formatMoney(p.cost)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
