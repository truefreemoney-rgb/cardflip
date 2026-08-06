"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import Spinner from "@/components/Spinner";
import CardImage from "@/components/CardImage";
import CardDetailModal from "@/components/CardDetailModal";
import LanguageToggle from "@/components/LanguageToggle";
import AppTabs from "@/components/AppTabs";
import { searchCards } from "@/lib/cards";
import { fetchCurrentUser, type SessionUser } from "@/lib/client/auth";
import {
  fetchPriceCheckHistory,
  logPriceCheck,
  type PriceCheckEntry,
} from "@/lib/client/priceChecksApi";
import type { PokemonCard, ScanLanguage } from "@/lib/types";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PriceCheckPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkedAuth, setCheckedAuth] = useState(false);

  const [language, setLanguage] = useState<ScanLanguage>("en");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<PokemonCard[]>([]);
  const [selected, setSelected] = useState<PokemonCard | null>(null);
  const [logging, setLogging] = useState(false);

  const [history, setHistory] = useState<PriceCheckEntry[]>([]);

  const loadHistory = useCallback(() => {
    fetchPriceCheckHistory().then(setHistory);
  }, []);

  useEffect(() => {
    fetchCurrentUser().then((current) => {
      if (!current) {
        router.replace("/signup");
        return;
      }
      setUser(current);
      setCheckedAuth(true);
    });
    loadHistory();
  }, [router, loadHistory]);

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    setSelected(null);
    try {
      const found = await searchCards(query.trim(), null, language);
      setResults(found);
      if (found.length === 0) setSearchError("No cards matched that name.");
    } catch {
      setSearchError("Search failed — check your connection.");
    } finally {
      setSearching(false);
    }
  }

  async function selectCard(card: PokemonCard) {
    setSelected(card);
    setLogging(true);
    await logPriceCheck(card, language);
    setLogging(false);
    loadHistory();
  }

  if (!checkedAuth || !user) return null;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 border-b border-white/5 bg-background/85 px-4 py-3 backdrop-blur-md sm:px-6">
        <Logo size="sm" />
        <AppTabs />
        <span className="hidden text-sm text-zinc-400 sm:inline">
          {user.name}
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Price check</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Look up any card&apos;s worth across every price source we have —
            no photo needed.
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-edge bg-surface-1 p-5">
          <LanguageToggle value={language} onChange={setLanguage} />
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Card name — e.g. Charizard"
              className="flex-1 rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400"
            />
            <button
              onClick={handleSearch}
              disabled={searching}
              className="flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-60"
            >
              {searching && <Spinner className="h-4 w-4" />}
              Search
            </button>
          </div>
          {searchError && <p className="text-xs text-red-400">{searchError}</p>}
        </div>

        {results.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {results.map((card) => (
              <button
                key={card.id}
                onClick={() => selectCard(card)}
                className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-left transition hover:-translate-y-0.5 ${
                  selected?.id === card.id
                    ? "border-brand-400 bg-brand-500/10"
                    : "border-edge bg-surface-1 hover:border-edge-strong"
                }`}
              >
                <CardImage
                  src={card.imageSmall}
                  alt={card.name}
                  className="aspect-[5/7] w-full rounded-lg"
                />
                <span className="w-full truncate text-xs font-medium text-white">
                  {card.name}
                </span>
                <span className="w-full truncate text-[11px] text-zinc-500">
                  {card.setName} · {card.number}
                </span>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <CardDetailModal
            card={selected}
            logging={logging}
            onClose={() => setSelected(null)}
          />
        )}

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Recent lookups ({history.length})
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-edge bg-surface-1">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/5 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-3 font-medium">Card</th>
                  <th className="px-4 py-3 font-medium">Language</th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Checked</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-medium text-white">{entry.cardName}</span>
                      <span className="ml-2 text-xs text-zinc-500">
                        {entry.setName} · {entry.cardNumber}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {entry.language === "en"
                        ? "English"
                        : entry.language === "ja"
                          ? "Japanese"
                          : "Chinese"}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-white">
                      {entry.representativePrice != null
                        ? `$${entry.representativePrice.toFixed(2)}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {formatDate(entry.checkedAt)}
                    </td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                      No lookups yet — search for a card above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
