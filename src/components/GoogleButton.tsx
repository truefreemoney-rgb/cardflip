"use client";

import { createContext, useContext, useState } from "react";
import Spinner from "@/components/Spinner";
import { readReferralCode, readTouch } from "@/components/AttributionCapture";
import XButton, { XEnabledContext } from "@/components/XButton";
import { GOOGLE_FAIL_MESSAGE } from "@/lib/googleAuth";

/**
 * "Continue with Google" at the top of the /login and /signup cards. The layouts (server
 * components) tell it whether GOOGLE_CLIENT_ID is set; with no keys the button, and the "or"
 * divider under it, are not rendered at all.
 */
const EnabledContext = createContext(false);

export function GoogleEnabled({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <EnabledContext.Provider value={enabled}>{children}</EnabledContext.Provider>;
}

/** The message for the page's error slot when we are sent back with ?google_error=N, else null. */
export function googleErrorFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const code = new URLSearchParams(window.location.search).get("google_error");
  if (!code) return null;
  return code === "2" ? "That account has extra security. Log in with your email and password." : GOOGLE_FAIL_MESSAGE;
}

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5 shrink-0" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 0 1 9.5 24c0-1.59.28-3.14.76-4.59l-7.98-6.19A23.99 23.99 0 0 0 0 24c0 3.77.9 7.35 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function GoogleButton({ mode }: { mode: "signup" | "login" }) {
  const enabled = useContext(EnabledContext);
  // "Continue with X" sits directly under this button and shares the "or" divider under both.
  const xEnabled = useContext(XEnabledContext);
  const [busy, setBusy] = useState(false);
  if (!enabled && !xEnabled) return null;

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
    window.location.assign(`/api/auth/google/start?${q.toString()}`);
  }

  return (
    <div className="mt-5">
      {enabled && (
        <button
          type="button"
          onClick={go}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2.5 rounded-full bg-white px-5 py-3 text-sm font-semibold text-zinc-800 shadow-lg shadow-black/30 transition hover:bg-zinc-100 disabled:opacity-70"
        >
          {busy ? <Spinner className="h-4 w-4" /> : <GoogleG />}
          Continue with Google
        </button>
      )}
      <XButton mode={mode} />
      <div className="mt-4 flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-edge" />
        <span className="text-[11px] uppercase tracking-widest text-zinc-600">or</span>
        <span className="h-px flex-1 bg-edge" />
      </div>
    </div>
  );
}
