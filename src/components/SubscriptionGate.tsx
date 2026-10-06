"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { canUseApp } from "@/lib/client/auth";
import { mergeUser } from "@/lib/client/emailConfirm";
import ConfirmEmailPanel from "@/components/ConfirmEmailPanel";
import Paywall from "@/components/Paywall";
import { toast } from "@/components/Toaster";

/**
 * Paid (09-04): every /app page needs a subscription or trial scans left. Admins
 * pass; so does /app/account, where billing lives (a lapsed seller has to
 * be able to reach the portal), /app/help (a stuck seller has to be able
 * to ask or open a ticket, 09-26), and /app/collection (Chris, 09-28: a
 * seller who ran out of scans still sees the cards they scanned; scanning,
 * importing and every eBay route refuse on the server with 402). While the
 * session is still loading the page renders its own skeleton — the wall
 * only replaces a ready session.
 *
 * Email confirmation (09-30) puts a wall in front of the paywall: a signup
 * that has not typed its emailed code sees the code screen on every page that
 * is not open. The open pages stay open on purpose (Account to fix the
 * address, Help for a ticket when the mail never comes).
 */
const OPEN_PATHS = ["/app/account", "/app/help", "/app/collection"];

export default function SubscriptionGate({ children }: { children: React.ReactNode }) {
  const { user, status, setUser, refresh } = useSession();
  const pathname = usePathname();
  // The scanner page that was usable when it opened stays up if the last scan spends the last free one (402 mid-session):
  // the paywall used to replace it and wipe the queue. Its own banner says scans ran out; the paywall shows on the next visit.
  const [scannerOpen, setScannerOpen] = useState(false);
  const usable = status === "ready" && !!user && canUseApp(user);
  if (scannerOpen !== (pathname === "/app" && (usable || scannerOpen))) setScannerOpen(!scannerOpen);
  if (status !== "ready" || !user) return <>{children}</>;
  if (user.role === "admin" || OPEN_PATHS.some((p) => pathname.startsWith(p))) return <>{children}</>;
  if (user.mustConfirmEmail) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center px-4 py-8 sm:justify-center sm:py-16">
        <div className="foil-edge relative w-full rounded-2xl p-6 shadow-xl shadow-black/40 [--foil-fill:#0b0d13] sm:p-8">
          <ConfirmEmailPanel
            mode="wall"
            user={user}
            onUser={(next) => setUser(mergeUser(user, next))}
            onConfirmed={(next, how) => {
              // Lift the wall now from what the server just said, then fetch
              // the full session (game switches, hasCards) behind it. A
              // release (our mail was down) is not a confirmation, so no toast.
              setUser(mergeUser(user, next));
              if (how !== "released") toast("Email confirmed");
              void refresh();
            }}
          />
        </div>
      </main>
    );
  }
  if (canUseApp(user)) {
    return <>{children}</>;
  }
  if (scannerOpen && pathname === "/app") return <>{children}</>;
  return <Paywall />;
}
