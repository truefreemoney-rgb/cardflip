import Link from "next/link";
import Logo from "@/components/Logo";

export default function MarketingNav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-white/5 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
        <Logo />
        <div className="flex items-center gap-3 text-sm sm:gap-6">
          <Link
            href="/admin"
            className="hidden text-zinc-400 transition hover:text-white sm:block"
          >
            Admin
          </Link>
          <Link
            href="/login"
            className="hidden text-zinc-400 transition hover:text-white sm:block"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-full bg-white px-4 py-2 font-medium text-zinc-900 transition hover:bg-zinc-200"
          >
            Get started
          </Link>
        </div>
      </div>
    </nav>
  );
}
