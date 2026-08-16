"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  EBAY_CONNECT_PATH,
  disconnectEbay,
  fetchEbayStatus,
  type EbayLinkStatus,
} from "@/lib/client/ebayApi";

/**
 * Plain-English mirror of USER_SCOPES in lib/server/ebayAuth.ts — the consent
 * screen asks for exactly these, so keep the two lists in step.
 */
const PERMISSIONS = [
  "Create draft listings under your eBay account (they show in My eBay › Drafts)",
  "Publish a listing from CardFlip when you choose to",
  "Read your shipping, payment and return policies so listings are complete",
  "See your eBay username so we can show which account is linked",
];

const OUTCOMES: Record<string, { tone: "ok" | "warn"; text: string }> = {
  connected: { tone: "ok", text: "eBay account linked." },
  declined: {
    tone: "warn",
    text: "You cancelled on eBay's side — nothing was linked.",
  },
  demo: {
    tone: "warn",
    text: "The demo account can't link a real eBay account. Create a free account to connect yours.",
  },
  state: {
    tone: "warn",
    text: "That sign-in attempt expired or didn't match this session. Try again.",
  },
  exchange: {
    tone: "warn",
    text: "eBay accepted the sign-in but we couldn't finish linking. Try again in a moment.",
  },
  unavailable: {
    tone: "warn",
    text: "eBay sign-in isn't live on this server yet.",
  },
};

interface Props {
  /** First name for the headline, if known. */
  firstName?: string | null;
  /** Label + destination of the bottom button. */
  doneLabel: string;
  onDone: () => void;
}

/**
 * The "Connect with eBay" step, shared by /connect-ebay and the second phase
 * of signup. Renders one of: connected-as (with disconnect), a real connect
 * button, the demo refusal, or the honest "not live yet" copy — decided by
 * /api/ebay/status, because whether OAuth is configured is a server secret.
 */
export default function EbayConnectCard({ firstName, doneLabel, onDone }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const pathname = usePathname();
  const [status, setStatus] = useState<EbayLinkStatus | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const outcomeKey = search.get("connected") ? "connected" : search.get("error");
  const outcome = outcomeKey ? OUTCOMES[outcomeKey] : null;

  useEffect(() => {
    fetchEbayStatus().then(setStatus);
  }, []);

  async function handleDisconnect() {
    // Reconnecting means going back through eBay's consent screen — worth
    // one confirmation before throwing the tokens away.
    if (!window.confirm("Disconnect your eBay account? You can reconnect any time, but you'll go through eBay's sign-in again.")) return;
    setDisconnectError(null);
    setBusy(true);
    const ok = await disconnectEbay();
    setBusy(false);
    if (!ok) {
      setDisconnectError("Couldn't disconnect just now — check your connection and try again.");
    }
    if (ok) {
      setStatus((s) => (s ? { ...s, connected: false, ebayUsername: null } : s));
      // Drop any ?connected=1 so the banner doesn't contradict the card.
      if (search.toString()) router.replace(pathname);
    }
  }

  const who = firstName ? `, ${firstName}` : "";
  const loading = status === undefined;
  const connected = Boolean(status?.connected);
  const canConnect = Boolean(status?.available) && !status?.demo && !connected;

  let title: string;
  let body: string;
  if (loading) {
    title = "Checking your eBay connection…";
    body = "";
  } else if (connected) {
    title = status?.ebayUsername
      ? `Connected as ${status.ebayUsername}`
      : "eBay account connected";
    body =
      "CardFlip can now create draft listings under your eBay account. You review and publish every listing yourself on eBay — nothing goes live without you.";
  } else if (status?.demo) {
    title = "The demo can't link eBay";
    body =
      "This shared demo account is wiped between visitors, so it never holds a real eBay connection. Create a free account and connect your own eBay in one click.";
  } else if (canConnect) {
    title = `Connect your eBay account${who}`;
    body =
      "You'll sign in on eBay's own site — we never see your eBay password. Then every card you scan can become a draft listing under your account.";
  } else {
    title = `eBay connection is on its way${who}`;
    body =
      "CardFlip is completing eBay's API onboarding. Until the direct connection is live, every listing opens on eBay pre-filled and you post it from your own account — you stay in full control, and we never see your eBay password.";
  }

  return (
    <div className="foil-edge relative w-full max-w-md rounded-2xl p-8 text-center shadow-xl shadow-black/40 [--foil-fill:#0b0d13]">
      <div
        className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-2xl ${
          connected
            ? "bg-emerald-500/15 text-emerald-400"
            : "bg-[conic-gradient(from_140deg,#7dd3fc,#a78bfa,#f0abfc,#6366f1,#7dd3fc)]"
        }`}
      >
        {connected ? "✓" : "🔗"}
      </div>

      {outcome && (
        <p
          role="status"
          className={`mt-5 rounded-lg px-3 py-2 text-sm ${
            outcome.tone === "ok"
              ? "bg-emerald-500/10 text-emerald-300"
              : "bg-amber-500/10 text-amber-200"
          }`}
        >
          {outcome.text}
        </p>
      )}

      <h1 className="mt-5 text-xl font-semibold text-white">{title}</h1>
      {body && (
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">{body}</p>
      )}

      {!connected && !status?.demo && (
        <>
          <p className="mt-5 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
            {canConnect
              ? "On eBay you'll approve exactly:"
              : "When the connection goes live, you'll approve exactly:"}
          </p>
          <ul className="mt-2 space-y-2 text-left">
            {PERMISSIONS.map((permission) => (
              <li
                key={permission}
                className="flex items-start gap-2.5 text-sm text-zinc-300"
              >
                <span
                  className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[10px] text-emerald-400"
                  aria-hidden
                >
                  ✓
                </span>
                {permission}
              </li>
            ))}
          </ul>
        </>
      )}

      {canConnect && (
        // A real navigation, not a fetch: the server answers with a redirect
        // to eBay's consent page and sets the state cookie on the way out.
        <a
          href={EBAY_CONNECT_PATH}
          className="mt-7 flex w-full items-center justify-center gap-2 rounded-full bg-ebay px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-ebay/25 transition hover:bg-ebay-hover"
        >
          Connect with eBay
        </a>
      )}

      {status?.demo && (
        <button
          onClick={() => router.push("/signup")}
          className="mt-7 w-full rounded-full bg-brand-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-400"
        >
          Create a free account
        </button>
      )}

      {connected && (
        <button
          onClick={handleDisconnect}
          disabled={busy}
          className="mt-7 w-full rounded-full border border-edge px-5 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-surface-2 disabled:opacity-60"
        >
          {busy ? "Disconnecting…" : "Disconnect eBay"}
        </button>
      )}
      {disconnectError && (
        <p role="alert" className="mt-3 text-xs text-red-400">
          {disconnectError}
        </p>
      )}

      <button
        onClick={onDone}
        className={`w-full rounded-full px-5 py-3 text-sm font-semibold transition ${
          canConnect || connected || status?.demo
            ? "mt-3 text-zinc-400 hover:text-white"
            : "mt-7 bg-brand-500 text-white shadow-lg shadow-brand-500/25 hover:bg-brand-400"
        }`}
      >
        {doneLabel}
      </button>
    </div>
  );
}
