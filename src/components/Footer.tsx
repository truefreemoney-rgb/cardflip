import Link from "next/link";

/**
 * Site footer for the marketing and legal pages. The legal links exist for
 * more than decoration: partner platforms (eBay's developer screening among
 * them) check that a site URL has real Terms/Privacy/Contact pages before
 * treating it as a legitimate business.
 */
export default function Footer() {
  return (
    <footer className="relative px-6 py-8 before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-holo-violet/20 before:to-transparent">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 text-xs text-zinc-600 sm:flex-row">
        <span>© {new Date().getFullYear()} CardFlip</span>
        <nav className="flex items-center gap-4">
          <Link href="/terms" className="transition hover:text-zinc-300">
            Terms of Service
          </Link>
          <Link href="/privacy" className="transition hover:text-zinc-300">
            Privacy Policy
          </Link>
          <a
            href="mailto:support@superiormarketing.com"
            className="transition hover:text-zinc-300"
          >
            Contact
          </a>
        </nav>
        <span className="text-center">
          Not affiliated with Nintendo, The Pokémon Company, Wizards of the Coast, or eBay Inc.
        </span>
      </div>
    </footer>
  );
}
