"use client";

import { useEffect } from "react";

/**
 * Invite a friend: a share link is cardflip.io/?ref=CODE. Whatever page it
 * lands on, remember the code in this browser so the signup form can send it
 * along. Nothing else reads it; a stale code is harmless (the server ignores
 * codes it doesn't know).
 */
const KEY = "cardflip.ref";

export function readReferralCode(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export default function RefCapture() {
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref && /^[A-Za-z0-9]{4,16}$/.test(ref)) localStorage.setItem(KEY, ref.toUpperCase());
    } catch {
      // Private mode / storage blocked — the signup just won't carry a code.
    }
  }, []);
  return null;
}
