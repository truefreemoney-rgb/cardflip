"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { readReferralCode, readTouch } from "@/components/AttributionCapture";
import { inPreviewFrame } from "@/lib/client/framed";
import { inAppBrowserName } from "@/lib/client/inAppBrowser";

/**
 * Google One Tap on the PUBLIC pages (Chris 10-11): Google's own small "Continue as <name>"
 * prompt for a visitor who is signed in to Google in this browser. One tap = account made (or
 * opened) through api/auth/google/onetap, no form. Rules:
 *  - public marketing pages only (allowlist below); never /app, /admin, /login, /signup;
 *  - never for someone already signed in here (one /api/auth/me check first);
 *  - shown ONCE per device, ever: a localStorage flag is set when the prompt is asked for, so a
 *    closed (X) or ignored prompt never comes back; leaving the page closes it (cancel on unmount);
 *  - nothing is loaded at all once the flag is set: no Google script, no request.
 * The root layout mounts it with the client id (public anyway: it is in the sign-in URL) or null
 * when Google sign-in is not configured, in which case this renders nothing and does nothing.
 */
const FLAG_KEY = "cardflip.onetap";
const GSI_SRC = "https://accounts.google.com/gsi/client";
/** Pages the prompt may appear on. Exact "/" plus these prefixes. */
const PUBLIC_PREFIXES = ["/pricing", "/features", "/help", "/pokemon", "/cards", "/scan", "/u/"];

type PromptMoment = {
  isNotDisplayed?: () => boolean;
  getNotDisplayedReason?: () => string;
};
type Gsi = {
  accounts: {
    id: {
      initialize: (o: Record<string, unknown>) => void;
      prompt: (cb?: (n: PromptMoment) => void) => void;
      cancel: () => void;
    };
  };
};
declare global {
  interface Window {
    google?: Gsi;
  }
}

export function isOneTapPage(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}

type Flag = "done" | { retryAfter: number; tries: number };

/** "done" = never again on this device; otherwise the earliest next try and how many were made. */
function readFlag(): Flag | null {
  try {
    const raw = localStorage.getItem(FLAG_KEY);
    if (!raw) return null;
    if (raw === "done") return "done";
    const [ts, tries] = raw.split(":").map(Number);
    return Number.isFinite(ts) ? { retryAfter: ts, tries: Number.isFinite(tries) ? tries : 1 } : "done";
  } catch {
    return "done"; // no storage = no way to keep the once-only promise, so never prompt
  }
}

function writeFlag(v: Flag) {
  try {
    localStorage.setItem(FLAG_KEY, v === "done" ? "done" : `${v.retryAfter}:${v.tries}`);
  } catch {
    /* ignore */
  }
}

/** A prompt Google reports it did not show: one more try tomorrow, three tries in all. */
export function nextFlagAfterNotShown(prev: Flag | null, now: number): Flag {
  const tries = (prev && prev !== "done" ? prev.tries : 0) + 1;
  return tries >= 3 ? "done" : { retryAfter: now + 24 * 60 * 60 * 1000, tries };
}

/** The server mints the nonce and keeps it in a cookie (10-22); the POST is checked against that, not against anything the page says. */
async function fetchNonce(): Promise<string | null> {
  try {
    const r = await fetch("/api/auth/google/onetap", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) return null;
    const data = (await r.json().catch(() => null)) as { nonce?: unknown } | null;
    return typeof data?.nonce === "string" && data.nonce.length >= 16 ? data.nonce : null;
  } catch {
    return null;
  }
}

function loadGsi(): Promise<Gsi | null> {
  return new Promise((resolve) => {
    if (window.google?.accounts?.id) return resolve(window.google);
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const s = existing ?? document.createElement("script");
    const done = () => resolve(window.google?.accounts?.id ? window.google : null);
    s.addEventListener("load", done, { once: true });
    s.addEventListener("error", () => resolve(null), { once: true });
    if (!existing) {
      s.src = GSI_SRC;
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }
  });
}

export default function GoogleOneTap({ clientId }: { clientId: string | null }) {
  const pathname = usePathname();

  useEffect(() => {
    // Not inside an app's own browser: Google refuses sign-in there (same rule as GoogleButton, 10-31: every Instagram
    // ad landing loaded Google's script and asked for a nonce for a prompt that can't finish).
    if (!clientId || !isOneTapPage(pathname) || inPreviewFrame() || inAppBrowserName() !== null) return;
    // ?onetap=1 forgets this device's flag so the prompt can be seen again (testing on a phone
    // where clearing site data is a chore). Not linked anywhere.
    if (new URLSearchParams(window.location.search).get("onetap") === "1") {
      try {
        localStorage.removeItem(FLAG_KEY);
      } catch {
        /* ignore */
      }
    }
    const flag = readFlag();
    if (flag === "done" || (flag && Date.now() < flag.retryAfter)) return;

    let cancelled = false;
    let gsi: Gsi | null = null;
    let nonce = "";

    async function onCredential(resp: { credential?: string }) {
      if (!resp?.credential) return;
      writeFlag("done");
      let res: Response | null = null;
      try {
        res = await fetch("/api/auth/google/onetap", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            credential: resp.credential,
            next: window.location.pathname + window.location.search,
            ref: readReferralCode(),
            touch: readTouch(),
            fromScan: window.location.pathname.startsWith("/scan"),
          }),
        });
      } catch {
        res = null;
      }
      if (res?.ok) {
        const data = (await res.json().catch(() => null)) as { next?: string } | null;
        window.location.assign(data?.next && data.next.startsWith("/") ? data.next : "/app");
        return;
      }
      if (res?.status === 409) {
        window.location.reload(); // already signed in after all
        return;
      }
      // Same plain-words messages the Google button shows (?google_error=1|2 on /login). Full
      // navigations on purpose throughout: the server just set (or refused) the session cookie.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/login?google_error=${res?.status === 403 ? 2 : 1}`);
    }

    (async () => {
      // Signed in here already? Then not now, and no flag: the prompt is still owed to this
      // device the first time it is signed out on a public page (10-11: Chris logged out to test
      // and a flag written while signed in had already silenced it).
      try {
        const me = await fetch("/api/auth/me", { credentials: "same-origin" });
        if (cancelled) return;
        if (me.ok) {
          const data = (await me.json().catch(() => null)) as { user?: unknown } | null;
          if (data?.user) return;
        } else if (me.status >= 500) {
          return; // not now; try another day
        }
      } catch {
        return;
      }
      gsi = await loadGsi();
      if (cancelled || !gsi) return;
      const minted = await fetchNonce();
      if (cancelled || !minted) return; // no nonce, no prompt; try another day
      nonce = minted;
      gsi.accounts.id.initialize({
        client_id: clientId,
        callback: onCredential,
        nonce,
        auto_select: false,
        cancel_on_tap_outside: false,
        itp_support: true,
        context: "signin",
        use_fedcm_for_prompt: true,
      });
      // Once per device: the flag goes down the moment we ask, so an X or an ignored prompt
      // never brings it back. Only a prompt Google says it did NOT show (older, non-FedCM
      // browsers report that) is allowed one more try, a day later.
      writeFlag("done");
      gsi.accounts.id.prompt((n) => {
        if (n?.isNotDisplayed?.()) writeFlag(nextFlagAfterNotShown(flag, Date.now()));
      });
    })();

    return () => {
      cancelled = true;
      // Leaving the page = prompt gone.
      try {
        gsi?.accounts.id.cancel();
      } catch {
        /* ignore */
      }
    };
  }, [clientId, pathname]);

  return null;
}
