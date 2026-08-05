"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import Spinner from "@/components/Spinner";
import OnboardingSteps from "@/components/OnboardingSteps";
import { connectEbay, fetchCurrentUser } from "@/lib/client/auth";

const PERMISSIONS = [
  "Create draft listings under your account",
  "Read your listing status so we can show progress",
];

export default function ConnectEbayPage() {
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);

  useEffect(() => {
    fetchCurrentUser().then((user) => {
      if (!user) {
        router.replace("/signup");
        return;
      }
      setUserName(user.name.split(" ")[0]);
    });
  }, [router]);

  async function handleConnect() {
    setConnecting(true);
    // Real flow: redirect to eBay's OAuth authorize URL, then exchange the
    // callback code for tokens server-side once an eBay developer app exists.
    try {
      await connectEbay();
      router.push("/app");
    } catch {
      setConnecting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="mb-8">
        <Logo />
      </div>

      <OnboardingSteps current={1} />

      <div className="w-full max-w-md rounded-2xl border border-edge bg-surface-1 p-8 text-center shadow-xl shadow-black/40">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-violet-600 text-2xl">
          🔗
        </div>

        <h1 className="mt-5 text-xl font-semibold text-white">
          {userName ? `One more step, ${userName}` : "Connect your eBay account"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          You&apos;ll sign in on eBay and approve access. We never see your eBay
          password.
        </p>

        <ul className="mt-5 space-y-2 text-left">
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

        <button
          onClick={handleConnect}
          disabled={connecting}
          className="mt-7 flex w-full items-center justify-center gap-2 rounded-full bg-ebay px-5 py-3 text-sm font-semibold text-white transition hover:bg-ebay-hover disabled:opacity-70"
        >
          {connecting && <Spinner className="h-4 w-4" />}
          {connecting ? "Connecting…" : "Connect with eBay"}
        </button>

        <button
          onClick={() => router.push("/app")}
          disabled={connecting}
          className="mt-3 w-full text-xs text-zinc-500 transition hover:text-zinc-300 disabled:opacity-50"
        >
          Skip for now — I&apos;ll connect later
        </button>
      </div>
    </div>
  );
}
