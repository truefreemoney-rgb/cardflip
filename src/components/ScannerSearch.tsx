"use client";

import { useState } from "react";
import Spinner from "@/components/Spinner";
import CardImage from "@/components/CardImage";
import { searchCards } from "@/lib/cards";
import {
  filterByPrintedNumber,
  formatCardNumber,
  parseCardQuery,
} from "@/lib/cardNumber";
import { gradeLabel, parseGradeQuery } from "@/lib/grading";
import { parseMtgQuery } from "@/lib/games";
import type { GameId, GradedInfo, PokemonCard, ScanLanguage } from "@/lib/types";

interface Props {
  language: ScanLanguage;
  /** Which catalogue to search; Pokémon when omitted. */
  game?: GameId;
  /**
   * Called with the picked card and the full result set (as alternates).
   * `grading` is set when the query named a slab ("Charizard 4/102 PSA 10")
   * — the card should enter the queue already graded.
   */
  onPick: (
    card: PokemonCard,
    alternates: PokemonCard[],
    grading: GradedInfo | null,
  ) => void;
}

/**
 * Type-to-add for the scanner: for the card the camera can't be pointed at —
 * already sleeved, at a grader, or listed from memory. Same parse and
 * full-result search as the Price check and wishlist pages.
 */
export default function ScannerSearch({ language, game = "pokemon", onPick }: Props) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PokemonCard[]>([]);
  // Captured at search time so editing the input afterwards can't change
  // what grade a click on the existing results applies.
  const [resultsGrading, setResultsGrading] = useState<GradedInfo | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  async function handleSearch() {
    if (!query.trim() || searching) return;
    setSearching(true);
    setError(null);
    try {
      // Grade first: left in, "PSA 10" reads as a collector number.
      const { rest, grading } = parseGradeQuery(query);
      let found: PokemonCard[];
      if (game === "mtg") {
        // "Lightning Bolt LTR 187" — set code + collector number, no fraction
        // needed; a number alone narrows to that number in every set.
        const { name, number, setCode } = parseMtgQuery(rest);
        if (!name && !(number && setCode)) {
          setResults([]);
          setError("Add the card's name — e.g. Lightning Bolt LTR 187.");
          return;
        }
        const printed = number || setCode ? { number: number ?? "", setTotal: null, setCode, isSecretRare: false } : null;
        found = await searchCards(name, printed, language, 200, "mtg");
        if (number) {
          const wanted = number.replace(/^0+(?=\d)/, "");
          const exact = found.filter((c) => c.number.replace(/^0+(?=\d)/, "").toLowerCase() === wanted);
          if (exact.length > 0) found = exact;
        }
      } else {
        const { name, printed } = parseCardQuery(rest);
        if (!name && !printed) {
          setResults([]);
          setError("Add the card's name too — e.g. Charizard 4/102 PSA 10.");
          return;
        }
        // A typed number is deliberate — show only the card it names.
        found = filterByPrintedNumber(
          await searchCards(name, printed, language, 200),
          printed,
        );
      }
      setResults(found);
      setResultsGrading(grading);
      setAddedIds(new Set());
      if (found.length === 0) setError("No cards matched that search.");
    } catch {
      setError("Search failed — check your connection.");
    } finally {
      setSearching(false);
    }
  }

  function handlePick(card: PokemonCard) {
    if (addedIds.has(card.id)) return;
    setAddedIds((prev) => new Set(prev).add(card.id));
    onPick(card, results, resultsGrading);
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder={
            game === "mtg"
              ? "Add a card by name — e.g. Lightning Bolt LTR 187 or Sol Ring PSA 10"
              : "Add a card by name — e.g. Charizard 4/102 or Charizard 4/102 PSA 10"
          }
          className="flex-1 rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400"
        />
        <button
          onClick={handleSearch}
          disabled={searching}
          className="flex items-center gap-2 rounded-lg border border-edge bg-surface-2 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition hover:bg-white/10 disabled:opacity-60"
        >
          {searching && <Spinner className="h-4 w-4" />}
          Search
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {resultsGrading && results.length > 0 && (
        <p className="text-xs text-brand-300">
          Graded slab — cards you pick are added as{" "}
          {gradeLabel(resultsGrading)}.
        </p>
      )}

      {results.length > 0 && (
        <div className="grid max-h-80 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-4 md:grid-cols-6">
          {results.map((card) => {
            const added = addedIds.has(card.id);
            return (
              <button
                key={card.id}
                onClick={() => handlePick(card)}
                className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-left transition ${
                  added
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "border-edge bg-black/20 hover:-translate-y-0.5 hover:border-edge-strong"
                }`}
              >
                <CardImage
                  src={card.imageSmall}
                  alt={card.name}
                  className="aspect-[5/7] w-full rounded-lg"
                />
                <span className="w-full truncate text-center text-xs font-medium text-white">
                  {card.name}
                </span>
                <span className="w-full truncate text-center text-[11px] text-zinc-500">
                  {card.setName} ·{" "}
                  {card.game === "mtg"
                    ? `${card.setCode ?? ""} ${card.number}`.trim()
                    : formatCardNumber(card.number, card.setTotal)}
                </span>
                <span
                  className={`text-[11px] font-semibold ${
                    added ? "text-emerald-400" : "text-brand-300"
                  }`}
                >
                  {added ? "✓ In queue" : "+ Add to queue"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
