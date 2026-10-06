"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CardImage from "@/components/CardImage";
import PageSkeleton from "@/components/PageSkeleton";
import ShareImageButton from "@/components/ShareImageButton";
import { useSession } from "@/components/SessionProvider";
import { toast } from "@/components/Toaster";
import { deletePackRequest, fetchPack, type PackDetail } from "@/lib/client/packsApi";
import { readActivePackId, saveActivePackId } from "@/lib/client/scanPrefs";
import { GAMES } from "@/lib/games";
import { formatMoney } from "@/lib/listing";
import { gainClass, roiLabel } from "@/lib/packs";
import { etDate } from "@/lib/time";

export default function PackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useSession();
  const [pack, setPack] = useState<PackDetail | null | undefined>(undefined);
  const [missing, setMissing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    void fetchPack(id).then((r) => {
      setMissing(Boolean(r?.missing));
      setPack(r?.pack ?? null);
    });
  }, [id]);

  function scanMore() {
    saveActivePackId(user?.id, id);
    router.push("/app");
  }

  async function remove() {
    if (!(await deletePackRequest(id))) {
      toast("Couldn't delete the pack. Try again.", "err");
      return;
    }
    // Its cards stay in Inventory; only the pack goes.
    if (readActivePackId(user?.id) === id) saveActivePackId(user?.id, null);
    router.replace("/app/packs");
  }

  if (pack === undefined) return <PageSkeleton variant="page" />;
  if (!pack) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-3 px-4 py-6">
        <p className="text-sm text-zinc-400">{missing ? "We can't find that pack." : "Couldn't load the pack. Refresh to try again."}</p>
        <Link href="/app/packs" className="text-sm font-medium text-brand-300 underline-offset-4 hover:underline">
          All Packs
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <Link href="/app/packs" className="text-xs font-medium text-brand-300 underline-offset-4 hover:underline">
          ← All Packs
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-white">{pack.name}</h1>
        <p className="text-sm text-zinc-500">
          {GAMES[pack.game].label} · {etDate(pack.createdAt)}
        </p>
      </div>

      <section className="rounded-xl border border-edge bg-surface-1 p-3">
        <p className={`text-3xl font-bold ${gainClass(pack.profit)}`}>
          {pack.profit < 0 ? "-" : pack.profit > 0 ? "+" : ""}
          {formatMoney(Math.abs(pack.profit))} <span className="text-lg">({roiLabel(pack.roiPct)})</span>
        </p>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
          {[
            ["Paid", formatMoney(pack.cost)],
            ["Pulled", formatMoney(pack.value)],
            ["Cards", String(pack.count)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-black/30 px-2 py-1.5">
              <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</dt>
              <dd className="text-sm font-semibold text-white">{value}</dd>
            </div>
          ))}
        </dl>
        {pack.best && (
          <p className="mt-2 text-xs text-zinc-400">
            Best pull: <span className="font-semibold text-white">{pack.best.cardName}</span> · {formatMoney(pack.best.value)}
          </p>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={scanMore} className="rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-400">
          Scan More Pulls
        </button>
        {pack.count > 0 && <ShareImageButton path={`/api/share/pack?id=${encodeURIComponent(pack.id)}`} fileName="my-pack" label="Share" className="!py-2" />}
        <Link href="/app/collection" className="inline-flex items-center rounded-full border border-edge bg-surface-1 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition hover:border-brand-400 hover:text-white">
          Inventory
        </Link>
      </div>

      {pack.pulls.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {pack.pulls.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl border border-edge bg-surface-1 p-2">
              <CardImage src={p.imageUrl} alt={p.cardName} className="aspect-[5/7] w-12 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{p.cardName}</p>
                <p className="truncate text-xs text-zinc-500">{p.setName}</p>
              </div>
              <p className="shrink-0 text-sm font-bold text-white">{formatMoney(p.value)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-400">No pulls yet. Tap Scan More Pulls and scan the cards from this pack.</p>
      )}

      <div className="mt-2 border-t border-edge pt-3">
        {confirmDelete ? (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-zinc-400">Delete this pack? Its cards stay in Inventory.</span>
            <button type="button" onClick={() => void remove()} className="font-semibold text-red-400 hover:text-red-300">
              Delete
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="text-zinc-400 hover:text-white">
              Keep
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className="text-xs text-zinc-500 hover:text-red-400">
            Delete Pack
          </button>
        )}
      </div>
    </main>
  );
}
