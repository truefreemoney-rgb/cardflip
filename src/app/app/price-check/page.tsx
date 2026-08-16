"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import Spinner from "@/components/Spinner";
import CardImage from "@/components/CardImage";
import CardDetailModal from "@/components/CardDetailModal";
import AppTabs from "@/components/AppTabs";
import GameToggle from "@/components/GameToggle";
import { searchCards } from "@/lib/cards";
import { filterByPrintedNumber, parseCardQuery } from "@/lib/cardNumber";
import { displayCardNumber, parseMtgQuery, readSavedGame, saveGame } from "@/lib/games";
import { fetchCurrentUser, type SessionUser, loginPathFor } from "@/lib/client/auth";
import {
  fetchPriceCheckHistory,
  logPriceCheck,
  type PriceCheckEntry,
} from "@/lib/client/priceChecksApi";
import type { GameId, PokemonCard, ScanLanguage } from "@/lib/types";

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

  // English-only for now — the ja/zh pipeline underneath still works;
  // restoring <LanguageToggle> here re-enables it.
  const language: ScanLanguage = "en";
  // Same per-browser game choice as the scanner.
  const [game, setGameState] = useState<GameId>(readSavedGame);
  function setGame(next: GameId) {
    setGameState(next);
    setResults([]);
    setSelected(null);
    saveGame(next);
  }
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
        router.replace(loginPathFor(window.location.pathname));
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
      // Sellers type what's printed on the card they're holding — "Charizard
      // 4/102". Splitting the fraction out makes that the most precise query
      // the lookup can take, instead of a name that matches nothing.
      let found: PokemonCard[];
      if (game === "mtg") {
        const { name, number, setCode } = parseMtgQuery(query);
        const printed = number || setCode ? { number: number ?? "", setTotal: null, setCode, isSecretRare: false } : null;
        found = await searchCards(name, printed, language, 200, "mtg");
        if (number) {
          const wanted = number.replace(/^0+(?=d)/, "");
          const exact = found.filter((c) => c.number.replace(/^0+(?=d)/, "").toLowerCase() === wanted);
          if (exact.length > 0) found = exact;
        }
      } else {
        const { name, printed } = parseCardQuery(query);
        // Every printing, not the scanner's top-24 — same as the wishlist search.
        // But a typed number is deliberate: show only the card it names.
        found = filterByPrintedNumber(
          await searchCards(name, printed, language, 200),
          printed,
        );
      }
      setResults(found);
      if (found.length === 0) setSearchError("No cards matched that search.");
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
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 bg-background/85 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-md after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-holo-violet/25 after:to-transparent sm:px-6">
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
          <GameToggle game={game} onChange={setGame} compact />
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder={game === "mtg" ? "Name or number — e.g. Lightning Bolt LTR 187" : "Name or number — e.g. Charizard 4/102"}
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
                {card.englishName && (
                  <span className="w-full truncate text-[11px] font-medium text-brand-300">
                    {card.englishName}
                  </span>
                )}
                <span className="w-full truncate text-[11px] text-zinc-500">
                  {card.setName} · {displayCardNumber(card)}
                </span>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <CardDetailModal
            card={selected}
            language={language}
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
