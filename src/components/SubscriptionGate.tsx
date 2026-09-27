"use client";

import { usePathname } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { canUseApp } from "@/lib/client/auth";
import Paywall from "@/components/Paywall";

/**
 * Paid (09-04): every /app page needs a subscription or trial scans left. Admins
 * pass; so does /app/account, where billing lives (a lapsed seller has to
 * be able to reach the portal), and /app/help (a stuck seller has to be able
 * to ask or open a ticket, 09-26). While the session is still loading the
 * page renders its own skeleton — the wall only replaces a ready session.
 */
export default function SubscriptionGate({ children }: { children: React.ReactNode }) {
  const { user, status } = useSession();
  const pathname = usePathname();
  if (status !== "ready" || !user) return <>{children}</>;
  if (user.role === "admin" || canUseApp(user) || pathname.startsWith("/app/account") || pathname.startsWith("/app/help")) return <>{children}</>;
  return <Paywall />;
}
