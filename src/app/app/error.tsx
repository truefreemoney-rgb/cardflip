"use client";

import Link from "next/link";

/** A crash inside the app: a dark, plain screen instead of Next's white "Application error". */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#0a0a0f] px-6 text-center">
      <h1 className="text-2xl font-semibold text-white">Something went wrong</h1>
      <p className="max-w-xs text-sm text-zinc-400">That didn&apos;t load. Try again, and if it keeps happening, come back in a minute.</p>
      <button type="button" onClick={reset} className="rounded-full bg-brand-500 px-6 py-3 text-base font-semibold text-white transition hover:bg-brand-400">
        Try Again
      </button>
      <Link href="/app" className="text-sm text-zinc-400 underline hover:text-white">
        Back to Scanner
      </Link>
    </main>
  );
}
