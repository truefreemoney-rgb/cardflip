"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPath } from "@/lib/client/basePath";
import { GAMES } from "@/lib/games";

type Gated = "mtg" | "lorcana" | "onepiece";
const ROWS: Gated[] = ["mtg", "lorcana", "onepiece"];

/**
 * Site switches (admin console). Each game after Pokémon is public or
 * admins-only — off hides its toggle, the landing copy and the help text
 * for everyone but admins, who keep the full thing to test on the live site.
 */
export default function FeatureToggles({ games: initial }: { games: Record<Gated, boolean> }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [pending, setPending] = useState<Gated | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function flip(game: Gated) {
    const next = !on[game];
    setPending(game);
    setError(null);
    try {
      const res = await fetch(apiPath("/api/admin/settings"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ games: { [game]: next } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't save");
      setOn((prev) => ({ ...prev, ...(data.games ?? {}) }));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      {ROWS.map((game) => (
        <div key={game} className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-200">{GAMES[game].fullName}</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {on[game]
                ? `Public. Every seller sees ${GAMES[game].label} in the game toggle.`
                : `Admins only. Sellers don't see ${GAMES[game].label}; you still get it to test on the live site.`}
            </p>
          </div>
          <button
            onClick={() => flip(game)}
            disabled={pending !== null}
            role="switch"
            aria-checked={on[game]}
            aria-label={`${GAMES[game].fullName} public`}
            className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${on[game] ? "bg-emerald-500" : "bg-zinc-700"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${on[game] ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </div>
      ))}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
