"use client";

import { usePathname } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { canUseApp } from "@/lib/client/auth";
import Paywall from "@/components/Paywall";

/**
 * Paid (09-04): every /app page needs a subscription or trial scans left. Admins
 * pass; so does /app/account, where billing lives (a lapsed seller has to
 * be able to reach the portal), /app/help (a stuck seller has to be able
 * to ask or open a ticket, 09-26), and /app/collection (Chris, 09-28: a
 * seller who ran out of scans still sees the cards they scanned; scanning,
 * importing and every eBay route refuse on the server with 402). While the
 * session is still loading the page renders its own skeleton — the wall
 * only replaces a ready session.
 */
const OPEN_PATHS = ["/app/account", "/app/help", "/app/collection"];

export default function SubscriptionGate({ children }: { children: React.ReactNode }) {
  const { user, status } = useSession();
  const pathname = usePathname();
  if (status !== "ready" || !user) return <>{children}</>;
  if (user.role === "admin" || canUseApp(user) || OPEN_PATHS.some((p) => pathname.startsWith(p))) return <>{children}</>;
  return <Paywall />;
}
