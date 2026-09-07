"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { fetchInvite, startCheckout, type InviteInfo } from "@/lib/client/accountApi";

/**
 * Rewards (Chris, 09-06): the page behind "Unlock 500 free scans". Short,
 * one job — hand the seller their link and say what it earns. Subscribers
 * only; a trial account sees the same page with a Subscribe button where
 * the link would be.
 */

const BONUS = 500;

const STEPS: { n: string; title: string; body: string }[] = [
  { n: "1", title: "Send your link", body: "Text it, post it, hand it to the guy at the card shop. Anyone who signs up through it is yours." },
  { n: "2", title: "They try it free", body: "Ten scans, no card. They point the camera at a card and it prices itself. Most people get it by scan three." },
  { n: "3", title: "They subscribe, you get 500", body: `The moment their first payment lands, ${BONUS} scans land in your account. Every friend, every time, no cap.` },
];

export default function RewardsPage() {
  const { user, status } = useSession();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  // Back from Stripe restores this page from the back-forward cache with
  // `busy` still true — the button stayed a spinner (mobile QA 09-06).
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  const subscribed = user?.tier === "subscribed";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    if (status !== "ready" || !user) return;
    let live = true;
    void fetchInvite().then((i) => {
      if (live) setInfo(i);
    });
    return () => {
      live = false;
    };
  }, [status, user]);

  async function copy() {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The link is printed below to long-press.
    }
  }
  async function share() {
    if (!info) return;
    try {
      await navigator.share({ title: "CardFlip", text: "Scan a card, price it, list it on eBay. Ten free scans:", url: info.url });
    } catch {
      // Dismissed.
    }
  }
  async function subscribe() {
    setBusy(true);
    try {
      window.location.href = await startCheckout("standard");
    } catch {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <section className="text-center">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Rewards</p>
        <h1 className="holo-text mt-2 font-display text-4xl font-bold leading-tight sm:text-5xl">Unlock {BONUS} Free Scans</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-zinc-400">
          Send a friend your link. When they subscribe, {BONUS} scans land in your account. That is a full month of CardFlip, for
          one text message.
        </p>
      </section>

      {/* The link, or the door to it. */}
      <section className="foil-edge rounded-2xl p-5 [--foil-fill:#0b0d13]">
        {subscribed ? (
          <>
            <p className="text-sm font-medium text-white">Your link</p>
            <p className="mt-2 select-all break-all rounded-lg border border-edge bg-surface-2 px-3 py-2.5 font-mono text-sm text-zinc-200">
              {info?.url ?? "Loading…"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copy}
                disabled={!info}
                className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-50"
              >
                {copied ? "Copied" : "Copy Link"}
              </button>
              {canShare && (
                <button
                  type="button"
                  onClick={share}
                  disabled={!info}
                  className="rounded-full border border-edge px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-edge-strong hover:text-white disabled:opacity-50"
                >
                  Share
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-white">Subscribers get a link</p>
            <p className="mt-1 text-sm text-zinc-400">
              Rewards are for subscribers. Subscribe, and your link is waiting on this page.
            </p>
            <button
              type="button"
              onClick={subscribe}
              disabled={busy || status !== "ready"}
              className="mt-3 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-50"
            >
              {busy ? "Opening…" : "Subscribe · $9.99/mo"}
            </button>
          </>
        )}
      </section>

      {subscribed && info && (
        <section className="grid grid-cols-3 gap-2">
          {[
            { label: "Friends joined", value: info.friendsJoined },
            { label: "Subscribed", value: info.friendsSubscribed },
            { label: "Scans earned", value: info.scansEarned },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-edge bg-surface-1 px-3 py-4 text-center">
              <p className="font-display text-2xl font-bold text-white">{s.value.toLocaleString("en-US")}</p>
              <p className="mt-0.5 text-[11px] uppercase tracking-wider text-zinc-500">{s.label}</p>
            </div>
          ))}
          {info.bonusScans > 0 && (
            <p className="col-span-3 text-center text-xs text-zinc-500">
              {info.bonusScans.toLocaleString("en-US")} bonus scans banked. They are used after your monthly allowance and never expire.
            </p>
          )}
        </section>
      )}

      <section className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface-1">
        {STEPS.map((s) => (
          <div key={s.n} className="flex items-start gap-4 px-5 py-4">
            <span className="holo-text w-8 shrink-0 font-display text-4xl font-bold leading-none">{s.n}</span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">{s.title}</p>
              <p className="mt-0.5 text-sm text-zinc-400">{s.body}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-edge bg-surface-1 p-5">
        <p className="text-sm font-medium text-white">The math</p>
        <p className="mt-1 text-sm text-zinc-400">
          A subscription is {BONUS} scans a month. One friend is a month on the house. Ten friends is most of a year. The scans stack,
          they wait behind your monthly allowance, and they never expire.
        </p>
      </section>

      <section className="px-1 text-xs text-zinc-600">
        <p>
          Subscribers only. The friend has to be new to CardFlip and sign up through your link. One reward per friend, credited when
          their first payment clears. Bonus scans are used after the monthly allowance. Questions:{" "}
          <Link href="/app/account" className="text-zinc-400 underline-offset-2 hover:underline">
            Account
          </Link>{" "}
          or support@cardflip.io.
        </p>
      </section>
    </main>
  );
}
