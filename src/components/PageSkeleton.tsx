/**
 * What an /app page shows for the beat between mount and the session answer.
 * Neutral bars in the page's own column, so the header stays put and the
 * content area doesn't flash blank.
 */
export default function PageSkeleton() {
  return (
    <main
      aria-busy
      aria-label="Loading"
      className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6"
    >
      <div className="flex animate-pulse flex-col gap-4">
        <div className="h-7 w-48 rounded-lg bg-white/10" />
        <div className="h-4 w-80 max-w-full rounded bg-white/5" />
        <div className="mt-4 h-28 rounded-2xl bg-white/5" />
        <div className="h-40 rounded-2xl bg-white/5" />
      </div>
    </main>
  );
}
