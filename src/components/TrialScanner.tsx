"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CameraCapture from "@/components/CameraCapture";
import CardImage from "@/components/CardImage";
import GameToggle from "@/components/GameToggle";
import { fetchCurrentUser } from "@/lib/client/auth";
import { trialScanWithVision } from "@/lib/client/visionApi";
import { TRIAL_DONE_KEY, matchTrialRead, savePendingScan, trialPrice } from "@/lib/client/trialScan";
import { searchTyped } from "@/lib/cards";
import { formatMoney } from "@/lib/listing";
import { GAMES } from "@/lib/games";
import { SCANS } from "@/lib/pricing";
import type { GameId, PokemonCard } from "@/lib/types";

/**
 * The ad landing page (10-05, /scan): one free scan with no account. The
 * camera reads one card, the market price shows, and "Save It" takes the
 * visitor to signup with the card waiting (lib/client/trialScan.ts). No
 * camera, or rather not: a name search shows prices too, but only a scan
 * is saved (the camera is the only way a card gets in, 10-03).
 */

type Phase =
  | { kind: "start" }
  | { kind: "reading" }
  | { kind: "found"; card: PokemonCard; scanned: boolean }
  | { kind: "miss"; message: string }
  | { kind: "used" };

/** One-tap names under the search (10-05, Chris): ad visitors rarely have a card in hand. */
const TRY: Record<GameId, string[]> = {
  pokemon: ["Charizard", "Pikachu", "Umbreon", "Mewtwo"],
  mtg: ["Black Lotus", "Sol Ring", "Lightning Bolt", "Counterspell"],
  lorcana: ["Elsa", "Mickey Mouse", "Stitch", "Maleficent"],
  onepiece: ["Luffy", "Zoro", "Shanks", "Nami"],
  yugioh: ["Blue-Eyes White Dragon", "Dark Magician", "Exodia", "Kuriboh"],
};

const CTA =
  "flex w-full items-center justify-center gap-2 rounded-full bg-brand-500 px-6 py-3.5 text-base font-semibold text-white transition hover:bg-brand-400";

/** Funnel step for the ad test (10-05): rides the visit counter as /scan/<step>, one row per visitor per day. */
function step(name: "camera" | "searched" | "price" | "miss" | "signup") {
  fetch("/api/visit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: `/scan/${name}` }), keepalive: true }).catch(() => {});
}

function readDone(): boolean {
  try {
    return localStorage.getItem(TRIAL_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function TrialScanner() {
  const [game, setGame] = useState<GameId>("pokemon");
  const [phase, setPhase] = useState<Phase>({ kind: "start" });
  const [cameraOpen, setCameraOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PokemonCard[] | null>(null);
  const [searching, setSearching] = useState(false);
  // False until localStorage has been read: the camera button waits for it so "used" visitors never see it flash.
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchCurrentUser()
      .then((u) => alive && u && setSignedIn(true))
      .catch(() => {});
    // After hydration (the server renders the start screen), off the effect body.
    const t = window.setTimeout(() => {
      if (readDone()) setPhase({ kind: "used" });
      setChecked(true);
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, []);

  async function onCapture(file: File) {
    setCameraOpen(false);
    setPhase({ kind: "reading" });
    const scan = await trialScanWithVision(file, game);
    if (scan.status !== "done" || !scan.read) step("miss");
    if (scan.status === "used") return setPhase({ kind: "used" });
    if (scan.status === "busy") return setPhase({ kind: "miss", message: "The free scanner is busy right now. Sign up and scan in the app" });
    if (scan.status !== "done" || !scan.read) return setPhase({ kind: "miss", message: "Couldn't read that photo. Try again, card flat and in the frame" });
    const match = await matchTrialRead(scan.read, game);
    if (!match.card) step("miss");
    if (!match.card) return setPhase({ kind: "miss", message: match.error ?? "No match for that one" });
    const g = scan.read.game ?? game;
    savePendingScan(match.card, g, scan.photo);
    try {
      localStorage.setItem(TRIAL_DONE_KEY, "1");
    } catch {
      // The server still counts the tries.
    }
    step("price");
    setPhase({ kind: "found", card: match.card, scanned: true });
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    await runSearch(query);
  }

  /** Priced cards first, repeats dropped; an example chip leads with the dearest printings (the hook). */
  async function runSearch(q: string, dearestFirst = false) {
    if (!q.trim()) return;
    setSearching(true);
    step("searched");
    const found = (await searchTyped(q, game, "en", { limit: 24, exact: false }).catch(() => [])) ?? [];
    const seen = new Set<string>();
    const ranked = found
      .map((card, i) => ({ card, i, p: trialPrice(card) }))
      .filter(({ card }) => {
        const key = `${card.setName}|${card.number}`;
        return !seen.has(key) && !!seen.add(key);
      })
      .sort((a, b) => (a.p == null ? 1 : 0) - (b.p == null ? 1 : 0) || (dearestFirst ? (b.p ?? 0) - (a.p ?? 0) : a.i - b.i));
    setResults(ranked.slice(0, 6).map(({ card }) => card));
    setSearching(false);
  }

  if (signedIn) {
    return (
      <Link href="/app" className={CTA}>
        Open the Scanner
      </Link>
    );
  }

  const found = phase.kind === "found" ? phase : null;
  const price = found ? trialPrice(found.card) : null;

  return (
    <div className="flex w-full flex-col gap-4">
      {found ? (
        <section className="foil-edge rounded-3xl p-4 [--foil-fill:#0d0f18]">
          <div className="flex gap-4">
            <CardImage src={found.card.imageSmall} alt={found.card.name} className="w-28 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl font-semibold leading-tight text-white">{found.card.englishName || found.card.name}</p>
              <p className="mt-1 text-sm text-zinc-400">
                {found.card.setName} · #{found.card.number}
              </p>
              {price != null ? (
                <>
                  <p className="holo-text font-display mt-3 text-4xl font-bold tabular-nums">{formatMoney(price)}</p>
                  <p className="text-xs text-zinc-500">Market price today, Near Mint</p>
                </>
              ) : (
                <p className="mt-3 text-sm text-amber-300">No trusted market price for this one yet</p>
              )}
            </div>
          </div>
          {!found.scanned && (
            <Link href="/signup?from=scan" onClick={() => step("signup")} className={`${CTA} mt-4`}>
              Scan Your Own Cards Free
            </Link>
          )}
          {found.scanned && (
            <>
              <Link href="/signup?from=scan" onClick={() => step("signup")} className={`${CTA} mt-4`}>
                Save It + {SCANS.trial} Free Scans
              </Link>
              <p className="mt-2 text-center text-xs text-zinc-500">It goes straight into your Inventory. No card needed.</p>
            </>
          )}
        </section>
      ) : null}
      {found?.scanned ? null : phase.kind === "used" ? (
        <section className="rounded-3xl border border-edge bg-surface-1 p-5 text-center">
          <p className="font-display text-lg font-semibold text-white">Your free scan is used</p>
          <p className="mt-1 text-sm text-zinc-400">Sign up for {SCANS.trial} more, free. No card needed.</p>
          <Link href="/signup?from=scan" onClick={() => step("signup")} className={`${CTA} mt-4`}>
            Get {SCANS.trial} Free Scans
          </Link>
        </section>
      ) : (
        <>
          <GameToggle game={game} onChange={setGame} block />
          {!checked ? (
            <div aria-hidden className="h-[60px] w-full animate-pulse rounded-full bg-surface-1" />
          ) : (
          <button type="button" onClick={() => {
              step("camera");
              setCameraOpen(true);
            }} disabled={phase.kind === "reading"} className={`${CTA} py-4 text-lg disabled:opacity-60`}>
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            {phase.kind === "reading" ? "Reading Your Card…" : phase.kind === "miss" ? "Try Again" : `Scan a ${GAMES[game].label} Card`}
          </button>
          )}
          {phase.kind === "miss" && (
            <p role="alert" className="-mt-1 text-center text-sm text-amber-300">
              {phase.message}
            </p>
          )}
          <form onSubmit={search} className="flex flex-col gap-2">
            <p className="flex items-center gap-3 text-xs text-zinc-500 before:flex-1 before:border-t before:border-edge after:flex-1 after:border-t after:border-edge">or type a name</p>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Try ${TRY[game][0]}`}
                className="min-w-0 flex-1 rounded-full border border-edge bg-black/40 px-4 py-2.5 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400 sm:text-sm"
              />
              <button type="submit" disabled={searching} className="rounded-full border border-edge-strong px-4 text-sm font-semibold text-white transition hover:bg-surface-2 disabled:opacity-60">
                {searching ? "…" : "Price It"}
              </button>
            </div>
            {!results && (
              <div className="flex flex-wrap gap-2">
                {TRY[game].map((name) => (
                  <button
                    key={name}
                    type="button"
                    disabled={searching}
                    onClick={() => {
                      setQuery(name);
                      void runSearch(name, true);
                    }}
                    className="rounded-full border border-edge bg-surface-1 px-3 py-1.5 text-sm text-white transition hover:bg-surface-2 disabled:opacity-60"
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
            {results && results.length === 0 && <p className="text-sm text-zinc-500">Nothing found. Try the name as printed.</p>}
            {results && results.length > 0 && (
              <ul className="flex flex-col divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface-1">
                {results.map((card) => {
                  const p = trialPrice(card);
                  return (
                    <li key={card.id}>
                      <button
                        type="button"
                        onClick={() => {
                          step("price");
                          setResults(null);
                          setPhase({ kind: "found", card, scanned: false });
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-surface-2"
                      >
                        <CardImage src={card.imageSmall} alt="" className="w-10 shrink-0 rounded" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-white">{card.englishName || card.name}</span>
                          <span className="block truncate text-xs text-zinc-500">
                            {card.setName} · #{card.number}
                          </span>
                        </span>
                        <span className="font-display text-sm font-semibold tabular-nums text-white">{p != null ? formatMoney(p) : "—"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </form>
          <p className="-mt-1 text-center text-xs text-zinc-500">One free scan. No account, no card.</p>
          {/* 10-05 (Chris): a straight path to the trial for anyone who would rather sign up first. */}
          <Link href="/signup?from=scan" onClick={() => step("signup")} className="-mt-1 text-center text-sm font-semibold text-brand-300 underline-offset-4 hover:underline">
            Skip and get {SCANS.trial} free scans
          </Link>
        </>
      )}

      {cameraOpen && <CameraCapture game={game} onGameChange={setGame} onCapture={(f) => void onCapture(f)} onClose={() => setCameraOpen(false)} />}
    </div>
  );
}
