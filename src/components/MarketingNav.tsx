import Link from "next/link";
import Logo from "@/components/Logo";

export default function MarketingNav() {
  return (
    <nav className="sticky top-4 z-50 px-4">
      <div className="foil-edge mx-auto flex w-full max-w-4xl items-center justify-between rounded-full py-2 pl-4 pr-2 shadow-xl shadow-black/40 backdrop-blur-md [--foil-fill:rgba(12,14,20,0.82)]">
        <Logo />
        <div className="flex items-center gap-2 text-sm sm:gap-5">
          {/* No admin link here: the dashboard is operator-only (and gated),
              and advertising it on the public nav reads as unfinished. It's
              reachable at /admin and linked from the app for admins. */}
          {/* Visible at every width — on a phone this is the only way back
              in for a returning seller (was sm:block, i.e. missing on mobile). */}
          <Link
            href="/login"
            className="px-2 py-2 text-zinc-300 transition hover:text-white sm:px-0"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="sheen rounded-full bg-white px-4 py-2 font-medium text-zinc-900 transition hover:bg-zinc-200"
          >
            Get started
          </Link>
        </div>
      </div>
    </nav>
  );
}
