import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
import TrialScanner from "@/components/TrialScanner";

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

export default function ScanLandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 pt-4">
        <Logo />
        <Link href="/login" className="px-2 py-2 text-sm text-zinc-400 transition hover:text-white">
          Log In
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-5 px-4 pb-10 pt-6">
        <div className="text-center">
          <h1 className="font-display text-4xl font-bold leading-[1.05] text-white">
            What&apos;s your card <span className="holo-text">worth?</span>
          </h1>
          <p className="mt-3 text-base text-zinc-400">Scan it or type its name. Today&apos;s market price in seconds.</p>
        </div>
        <TrialScanner />
        <p className="text-center text-xs text-zinc-600">Pokémon, Magic, Lorcana, One Piece and Yu-Gi-Oh!</p>
      </main>
    </div>
  );
}
