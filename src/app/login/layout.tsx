import { GoogleEnabled } from "@/components/GoogleButton";
import { XEnabled } from "@/components/XButton";
import { googleConfigured } from "@/lib/server/googleAuth";
import { xConfigured } from "@/lib/server/xAuth";
import { PRIVATE_META } from "@/lib/pageMeta";

// Out of the index and the sitemap (09-30): people reach sign-in from the nav, never from a search.
export const metadata = PRIVATE_META.login;

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  // No Google keys on the server = no Continue with Google button (components/GoogleButton.tsx).
  // Same for Continue with X (components/XButton.tsx).
  return (
    <GoogleEnabled enabled={googleConfigured()}>
      <XEnabled enabled={xConfigured()}>{children}</XEnabled>
    </GoogleEnabled>
  );
}
