"use client";

import { apiPath } from "@/lib/client/basePath";

/**
 * First-login tutorial plumbing. The server flag (users.tour_seen_at) is the
 * truth for "owed"; the sessionStorage key is only the account page's way
 * of asking the scanner to run it once more.
 */

const REPLAY_KEY = "cardflip.tourReplay";

/** Account page → "Replay": the next scanner mount starts the tour. */
export function requestTourReplay(): void {
  try {
    sessionStorage.setItem(REPLAY_KEY, "1");
  } catch {
    // Storage blocked — the replay just won't run.
  }
}

/** Read-and-clear, so a replay runs exactly once. */
export function takeTourReplay(): boolean {
  try {
    const on = sessionStorage.getItem(REPLAY_KEY) === "1";
    if (on) sessionStorage.removeItem(REPLAY_KEY);
    return on;
  } catch {
    return false;
  }
}

/** Finished or skipped — stamp the account so it never auto-shows again. */
export async function markTourSeen(): Promise<void> {
  try {
    await fetch(apiPath("/api/account/tour"), { method: "POST" });
  } catch {
    // Offline: the flag stays unset and the tour shows once more next time.
  }
}
