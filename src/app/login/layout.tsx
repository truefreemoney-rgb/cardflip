import { GoogleEnabled } from "@/components/GoogleButton";
import { googleConfigured } from "@/lib/server/googleAuth";
import { PRIVATE_META } from "@/lib/pageMeta";

// Out of the index and the sitemap (09-30): people reach sign-in from the nav, never from a search.
export const metadata = PRIVATE_META.login;

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  // No Google keys on the server = no Continue with Google button (components/GoogleButton.tsx).
  return <GoogleEnabled enabled={googleConfigured()}>{children}</GoogleEnabled>;
}
