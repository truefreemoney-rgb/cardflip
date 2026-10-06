/**
 * What an /app page shows for the beat between mount and the session answer,
 * and what route changes show (loading.tsx). Neutral shimmer shapes in the
 * page's own column so the header stays put and nothing flashes blank.
 * Server component; `variant` picks the silhouette of the real page.
 */
type Variant = "page" | "scanner" | "grid" | "catalog" | "card";

const bar = "skeleton rounded-lg";

export default function PageSkeleton({ variant = "page" }: { variant?: Variant }) {
  if (variant === "scanner") {
    return (
      <main aria-busy aria-label="Loading" className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6">
        <div className={`${bar} h-11 w-full rounded-full`} />
        <div className="skeleton mx-auto aspect-[5/7] max-h-[55dvh] w-full max-w-sm rounded-2xl" />
        <div className={`${bar} mx-auto h-14 w-full max-w-sm rounded-full`} />
      </main>
    );
  }
  if (variant === "grid") {
    return (
      <main aria-busy aria-label="Loading" className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <div className={`${bar} h-7 w-48`} />
        <div className={`${bar} mt-4 h-10 w-full rounded-full`} />
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton aspect-[5/8] rounded-xl" />
          ))}
        </div>
      </main>
    );
  }
  if (variant === "catalog") {
    return (
      <main aria-busy aria-label="Loading" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <div className={`${bar} h-9 w-64 max-w-full sm:h-12`} />
        <div className={`${bar} mt-3 h-4 w-full max-w-prose`} />
        <div className="mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="skeleton h-14 rounded-xl" />
          ))}
        </div>
      </main>
    );
  }
  if (variant === "card") {
    return (
      <main aria-busy aria-label="Loading" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-6 sm:flex-row">
          <div className="skeleton mx-auto aspect-[5/7] w-56 shrink-0 rounded-xl sm:mx-0 sm:w-64" />
          <div className="flex flex-1 flex-col gap-3">
            <div className={`${bar} h-9 w-3/4`} />
            <div className={`${bar} h-4 w-1/2`} />
            <div className={`${bar} mt-2 h-12 w-40`} />
            <div className="skeleton mt-3 h-40 rounded-2xl" />
          </div>
        </div>
      </main>
    );
  }
  return (
    <main aria-busy aria-label="Loading" className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-4">
        <div className={`${bar} h-7 w-48`} />
        <div className={`${bar} h-4 w-80 max-w-full`} />
        <div className="skeleton mt-4 h-28 rounded-2xl" />
        <div className="skeleton h-40 rounded-2xl" />
      </div>
    </main>
  );
}
