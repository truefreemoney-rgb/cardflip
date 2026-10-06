import Link from "next/link";

/**
 * A missing page inside /app. The app layout (header with AppTabs, scan counter,
 * footer) still wraps this, so the tabs stay on screen; this is only the body.
 */
export default function AppNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <p className="holo-text text-4xl font-bold">404</p>
      <h1 className="text-xl font-semibold text-white">That page isn&apos;t here</h1>
      <p className="text-sm text-zinc-400">The link may be old. Use the tabs above, or go back to the scanner.</p>
      <Link href="/app" className="mt-2 rounded-full bg-brand-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-400">
        Back to the scanner
      </Link>
    </main>
  );
}
