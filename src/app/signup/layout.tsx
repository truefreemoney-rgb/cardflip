import { GoogleEnabled } from "@/components/GoogleButton";
import { XEnabled } from "@/components/XButton";
import { googleConfigured } from "@/lib/server/googleAuth";
import { xConfigured } from "@/lib/server/xAuth";
import { PUBLIC_META } from "@/lib/pageMeta";

export const metadata = PUBLIC_META.signup;

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  // No Google keys on the server = no Continue with Google button (components/GoogleButton.tsx).
  // Same for Continue with X (components/XButton.tsx).
  return (
    <GoogleEnabled enabled={googleConfigured()}>
      <XEnabled enabled={xConfigured()}>{children}</XEnabled>
    </GoogleEnabled>
  );
}
