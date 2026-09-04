"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPath } from "@/lib/client/basePath";

/**
 * Site switches (admin console). Magic: The Gathering public or admins-only
 * — off hides the game toggle, the landing copy and the help text for
 * everyone but admins, who keep the full thing to test on the live site.
 */
export default function FeatureToggles({ magicPublic: initial }: { magicPublic: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip() {
    const next = !on;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(apiPath("/api/admin/settings"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ magicPublic: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't save");
      setOn(Boolean(data.magicPublic));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-200">Magic: The Gathering</p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {on
            ? "Public. Every seller sees the Pokémon | Magic toggle and the site mentions both games."
            : "Admins only. Sellers see a Pokémon-only product; you still get the Magic toggle, catalogue and pricing to test on the live site."}
        </p>
        {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
      </div>
      <button
        onClick={flip}
        disabled={pending}
        role="switch"
        aria-checked={on}
        aria-label="Magic: The Gathering public"
        className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${on ? "bg-emerald-500" : "bg-zinc-700"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}
