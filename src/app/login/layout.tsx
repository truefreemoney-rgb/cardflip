import { PRIVATE_META } from "@/lib/pageMeta";

// Out of the index and the sitemap (09-30): people reach sign-in from the nav, never from a search.
export const metadata = PRIVATE_META.login;

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
