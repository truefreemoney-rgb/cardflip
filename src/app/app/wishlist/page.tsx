"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import CardImage from "@/components/CardImage";
import AppTabs from "@/components/AppTabs";
import { fetchCurrentUser, type SessionUser } from "@/lib/client/auth";
import {
  fetchWishlist,
  removeFromWishlist,
  type WishlistItem,
} from "@/lib/client/wishlistApi";

const LANGUAGE_LABEL: Record<string, string> = {
  en: "English",
  ja: "Japanese",
  zh: "Chinese",
};

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function WishlistPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkedAuth, setCheckedAuth] = useState(false);
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCurrentUser().then((current) => {
      if (!current) {
        router.replace("/signup");
        return;
      }
      setUser(current);
      setCheckedAuth(true);
    });
    fetchWishlist()
      .then(setItems)
      .finally(() => setLoading(false));
  }, [router]);

  async function handleRemove(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await removeFromWishlist(id);
  }

  if (!checkedAuth || !user) return null;

  const total = items.reduce((sum, i) => sum + (i.price ?? 0), 0);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 border-b border-white/5 bg-background/85 px-4 py-3 backdrop-blur-md sm:px-6">
        <Logo size="sm" />
        <AppTabs />
        <span className="hidden text-sm text-zinc-400 sm:inline">
          {user.name}
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-white">Wishlist</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Cards you&apos;ve saved from the scanner or search, in one place.
            </p>
          </div>
          {items.length > 0 && (
            <div className="text-right">
              <p className="text-lg font-semibold text-emerald-400">
                ${total.toFixed(2)}
              </p>
              <p className="text-xs text-zinc-500">
                {items.length} card{items.length === 1 ? "" : "s"} saved
              </p>
            </div>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-edge-strong bg-surface-1 py-16 text-center">
            <div className="text-3xl">☆</div>
            <p className="text-sm font-medium text-white">
              Your wishlist is empty
            </p>
            <p className="max-w-xs text-xs text-zinc-500">
              Save cards from the scanner or the search page and they&apos;ll
              show up here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {items.map((item) => (
              <div
                key={item.id}
                className="group relative flex flex-col items-center gap-2 rounded-xl border border-edge bg-surface-1 p-3"
              >
                <button
                  onClick={() => handleRemove(item.id)}
                  aria-label={`Remove ${item.cardName} from wishlist`}
                  className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-zinc-400 opacity-0 transition hover:bg-black/80 hover:text-white group-hover:opacity-100"
                >
                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M5 5l10 10M15 5l-10 10" strokeLinecap="round" />
                  </svg>
                </button>

                <CardImage
                  src={item.imageUrl}
                  alt={item.cardName}
                  className="aspect-[5/7] w-full rounded-lg"
                />
                <span className="w-full truncate text-center text-xs font-medium text-white">
                  {item.cardName}
                </span>
                {item.englishName && (
                  <span className="w-full truncate text-center text-[11px] font-medium text-brand-300">
                    {item.englishName}
                  </span>
                )}
                <span className="w-full truncate text-center text-[11px] text-zinc-500">
                  {item.setName} · {item.cardNumber}
                </span>
                <span className="w-full truncate text-center text-[10px] text-zinc-600">
                  {LANGUAGE_LABEL[item.language]} · {formatDate(item.addedAt)}
                </span>
                {item.price != null && (
                  <span className="text-sm font-semibold text-emerald-400">
                    ${item.price.toFixed(2)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
