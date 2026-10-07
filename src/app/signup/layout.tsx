import { GoogleEnabled } from "@/components/GoogleButton";
import { googleConfigured } from "@/lib/server/googleAuth";
import { PUBLIC_META } from "@/lib/pageMeta";

export const metadata = PUBLIC_META.signup;

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  // No Google keys on the server = no Continue with Google button (components/GoogleButton.tsx).
  return <GoogleEnabled enabled={googleConfigured()}>{children}</GoogleEnabled>;
}
