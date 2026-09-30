import { PRIVATE_META } from "@/lib/pageMeta";

// The egg is client-only, so its metadata lives here. Without this it was indexable and inherited the landing page's title.
export const metadata = PRIVATE_META.egg;

export default function EggLayout({ children }: { children: React.ReactNode }) {
  return children;
}
