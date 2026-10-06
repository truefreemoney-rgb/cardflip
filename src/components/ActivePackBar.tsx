"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchPack, type PackDetail } from "@/lib/client/packsApi";
import { readActivePackId, saveActivePackId } from "@/lib/client/scanPrefs";
import { formatMoney } from "@/lib/listing";
import type { GameId } from "@/lib/types";

/**
 * "Scanning pulls from X" strip on the scanner (audit G8). Shows only while a pack is open for this
 * user; Done closes it and goes to the pack page. A pack that was deleted meanwhile clears itself.
 * `refreshKey` changes when the queue does, so the pull count and value follow each scan.
 */
export default function ActivePackBar({ userId, refreshKey, onGame }: { userId: string | null | undefined; refreshKey: number; onGame: (game: GameId) => void }) {
  const [pack, setPack] = useState<PackDetail | null>(null);

  useEffect(() => {
    const id = readActivePackId(userId);
    if (!id) return;
    let live = true;
    void fetchPack(id).then((r) => {
      if (!live || !r) return;
      if (r.missing) saveActivePackId(userId, null);
      setPack(r.pack);
    });
    return () => {
      live = false;
    };
  }, [userId, refreshKey]);

  // The scanner reads against the pack's own game; switch once, when the pack first shows.
  const packId = pack?.id;
  const packGame = pack?.game;
  useEffect(() => {
    if (packGame) onGame(packGame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per pack, not on every game switch
  }, [packId]);

  if (!pack || readActivePackId(userId) !== pack.id) return null;
  return (
    <div className="mx-auto flex w-full max-w-md items-center gap-3 px-4 pt-3">
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border border-brand-400/40 bg-brand-500/10 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">Pack: {pack.name}</p>
          <p className="text-xs text-zinc-400">
            {pack.count} {pack.count === 1 ? "pull" : "pulls"} · {formatMoney(pack.value)} · paid {formatMoney(pack.cost)}
          </p>
        </div>
        <Link
          href={`/app/packs/${pack.id}`}
          onClick={() => saveActivePackId(userId, null)}
          className="shrink-0 rounded-full bg-brand-500 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-400"
        >
          Done
        </Link>
      </div>
    </div>
  );
}
