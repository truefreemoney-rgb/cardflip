"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchCurrentUser } from "@/lib/client/auth";

/**
 * The landing page's "Try 10 Scans Free" button, session-aware (Chris,
 * 09-07: "after a user makes an account and logged in, the try 10 free
 * scans button should just be Open the App"). The page is a server
 * component; this renders the signup link first (identical markup for
 * crawlers and the first paint, same trick as PlanCta) and swaps to the
 * app link once /api/auth/me says someone is signed in.
 */
export default function TrialCta({ className }: { className: string }) {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser()
      .then((u) => {
        if (!cancelled && u) setSignedIn(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return signedIn ? (
    <Link href="/app" className={className}>
      Open the App
    </Link>
  ) : (
    <Link href="/signup" className={className}>
      Try 10 Scans Free
    </Link>
  );
}
