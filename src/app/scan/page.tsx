import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
import TrialScanner from "@/components/TrialScanner";
import { catalogSizeLabel } from "@/lib/server/catalogStats";
import { GAME_IDS, isGameId } from "@/lib/games";
import { getGameStageCards } from "@/lib/server/stageCards";
import type { ScanExample } from "@/components/TrialScanner";
import type { GameId } from "@/lib/types";
import LiveStatsStrip from "@/components/LiveStatsStrip";
import { liveStats } from "@/lib/server/liveStats";
import { getCurrentUser } from "@/lib/server/auth";

/**
 * The ad landing page (10-05): the TikTok ads point here, not at the home
 * page. One screen on a phone: the question, the Scan button, the name search.
 * Kept out of search results (the home page is the one to rank).
 */
export const metadata: Metadata = {
  title: "What's your card worth?",
  description: "Scan a Pokémon, Magic, Lorcana, One Piece or Yu-Gi-Oh! card with your phone and see its market price. One free scan, no account.",
  robots: { index: false, follow: true },
};

const STEPS = [
  { n: "1", t: "Scan", d: "Snap your card" },
  { n: "2", t: "Price", d: "See its value" },
  { n: "3", t: "Save", d: "Keep it free" },
];

/** /scan?game=magic (or mtg, pokemon, yugioh, lorcana, onepiece); anything else keeps the default. */
function gameParam(v: string | undefined): GameId {
  const k = (v ?? "").toLowerCase();
  return k === "magic" ? "mtg" : isGameId(k) ? k : "pokemon";
}

export default async function ScanLandingPage({ searchParams }: { searchParams: Promise<{ game?: string | string[] }> }) {
  const sp = await searchParams;
  const initialGame = gameParam(Array.isArray(sp.game) ? sp.game[0] : sp.game);
  const label = await catalogSizeLabel().catch(() => "Every printing");
  const stats = await liveStats();
  // No cookie (every ad visitor) = no DB read; a session = the signed-in screen from the first frame.
  const signedIn = Boolean(await getCurrentUser().catch(() => null));
  // One real example card per game: the lead of the home page's stage reel (cached 6 h, guarded, $15-$300). None found = none shown.
  const examples: Partial<Record<GameId, ScanExample>> = {};
  await Promise.all(
    GAME_IDS.map(async (g) => {
      const c = (await getGameStageCards(g).catch(() => null))?.cards.find((x) => x.lead && x.imageUrl && x.price != null && x.price > 0);
      if (c && c.price != null) examples[g] = { name: c.name, setName: c.setName, image: c.imageUrl, price: c.price };
    }),
  );
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 pt-4">
        <Logo />
        <Link href="/login" className="px-2 py-2 text-sm text-zinc-400 transition hover:text-white">
          Log In
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-5 px-4 pb-10 pt-6">
        <LiveStatsStrip stats={stats} />
        <div className="text-center">
          <h1 className="font-display text-4xl font-bold leading-[1.05] text-white">
            What&apos;s your card <span className="holo-text">worth?</span>
          </h1>
          <p className="mt-3 text-base text-zinc-400">Scan it or type its name. Today&apos;s market price in seconds.</p>
        </div>
        <TrialScanner
          initialGame={initialGame}
          initialSignedIn={signedIn}
          examples={examples}
          footer={
            <>
              <ol className="grid w-full grid-cols-3 gap-2">
                {STEPS.map((s) => (
                  <li key={s.n} className="rounded-2xl border border-edge bg-surface-1 px-2 py-3 text-center">
                    <span className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white">{s.n}</span>
                    <p className="mt-1 font-display text-base font-semibold text-white">{s.t}</p>
                    <p className="text-xs text-zinc-400">{s.d}</p>
                  </li>
                ))}
              </ol>
              <p className="text-center text-sm font-semibold text-zinc-300">{label.endsWith("+") ? `${label} cards with live prices` : "Live prices on every printing"}</p>
              <p className="-mt-2 text-center text-xs text-zinc-600">Pokémon, Magic, Lorcana, One Piece and Yu-Gi-Oh!</p>
            </>
          }
        />
      </main>
    </div>
  );
}
