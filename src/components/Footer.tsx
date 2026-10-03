import Link from "next/link";
import { NOT_AFFILIATED } from "@/lib/games";

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
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-0.5">
          <Link href="/features" className="py-1.5 transition hover:text-zinc-300">
            Features
          </Link>
          <Link href="/pricing" className="py-1.5 transition hover:text-zinc-300">
            Pricing
          </Link>
          <Link href="/cards" className="py-1.5 transition hover:text-zinc-300">
            Card Prices
          </Link>
          <Link href="/help" className="py-1.5 transition hover:text-zinc-300">
            Help
          </Link>
          <Link href="/terms" className="py-1.5 transition hover:text-zinc-300">
            Terms of Service
          </Link>
          <Link href="/privacy" className="py-1.5 transition hover:text-zinc-300">
            Privacy Policy
          </Link>
          <a
            href="mailto:support@cardflip.io"
            className="py-1.5 transition hover:text-zinc-300"
          >
            Contact
          </a>
        </nav>
        <span className="text-center">
          {NOT_AFFILIATED}
        </span>
      </div>
    </footer>
  );
}
