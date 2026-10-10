"use client";

import { createContext, useContext, useState } from "react";
import Spinner from "@/components/Spinner";
import { readReferralCode, readTouch } from "@/components/AttributionCapture";
import { X_FAIL_MESSAGE } from "@/lib/xAuth";

/**
 * "Continue with X", the twin of GoogleButton. The layouts (server components) tell it whether
 * X_CLIENT_ID and X_CLIENT_SECRET are set; with no keys it is not rendered at all. GoogleButton
 * renders it right under the Google button (and owns the "or" divider under both).
 */
export const XEnabledContext = createContext(false);

export function XEnabled({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <XEnabledContext.Provider value={enabled}>{children}</XEnabledContext.Provider>;
}

/** The message for the page's error slot when we are sent back with ?x_error=N, else null. */
export function xErrorFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const code = new URLSearchParams(window.location.search).get("x_error");
  if (!code) return null;
  return code === "2" ? "That account has extra security. Log in with your email and password." : X_FAIL_MESSAGE;
}

function XLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden>
      <path
        fill="#000000"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      />
    </svg>
  );
}

export default function XButton({ mode }: { mode: "signup" | "login" }) {
  const enabled = useContext(XEnabledContext);
  const [busy, setBusy] = useState(false);
  if (!enabled) return null;

  function go() {
    setBusy(true);
    const here = new URLSearchParams(window.location.search);
    const q = new URLSearchParams({ mode });
    const next = here.get("next");
    if (next) q.set("next", next);
    if (here.get("from") === "scan") q.set("from", "scan");
    // Same things the email signup form sends: the invite code and where the visitor first came from.
    const ref = readReferralCode();
    if (ref) q.set("ref", ref);
    const touch = readTouch();
    if (touch) q.set("touch", JSON.stringify(touch));
    window.location.assign(`/api/auth/x/start?${q.toString()}`);
  }

  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      className="mt-3 flex w-full items-center justify-center gap-2.5 rounded-full bg-white px-5 py-3 text-sm font-semibold text-zinc-800 shadow-lg shadow-black/30 transition hover:bg-zinc-100 disabled:opacity-70"
    >
      {busy ? <Spinner className="h-4 w-4" /> : <XLogo />}
      Continue with X
    </button>
  );
}
