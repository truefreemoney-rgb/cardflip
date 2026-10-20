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
    <footer className="relative px-4 pt-6 sm:px-6 pb-[calc(2rem+var(--bottom-nav-h,0px))] before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-holo-violet/20 before:to-transparent">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 text-sm text-zinc-400 sm:flex-row">
        <span>© {new Date().getFullYear()} CardFlip</span>
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-0.5">
          <Link href="/features" className="inline-flex min-h-11 items-center transition hover:text-zinc-200">
            Features
          </Link>
          <Link href="/pricing" className="inline-flex min-h-11 items-center transition hover:text-zinc-200">
            Pricing
          </Link>
          <Link href="/cards" className="inline-flex min-h-11 items-center transition hover:text-zinc-200">
            Card Prices
          </Link>
          <Link href="/help" className="inline-flex min-h-11 items-center transition hover:text-zinc-200">
            Help
          </Link>
          <Link href="/terms" className="inline-flex min-h-11 items-center transition hover:text-zinc-200">
            Terms of Service
          </Link>
          <Link href="/privacy" className="inline-flex min-h-11 items-center transition hover:text-zinc-200">
            Privacy Policy
          </Link>
          <a
            href="mailto:support@cardflip.io"
            className="inline-flex min-h-11 items-center transition hover:text-zinc-200"
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
