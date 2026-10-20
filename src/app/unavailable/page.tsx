import type { Metadata } from "next";
import { headers } from "next/headers";
import Logo from "@/components/Logo";
import WaitlistForm from "@/components/WaitlistForm";
import { countryName } from "@/lib/countries";
import { TAP_LINK } from "@/lib/tap";

/**
 * What everyone outside the open countries sees (src/proxy.ts rewrites every
 * page here, Chris 09-30). Never indexed; links are plain <a> so nothing is
 * prefetched through the gate.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Not Available Yet",
  robots: { index: false, follow: false },
};

export default async function UnavailablePage() {
  const code = (await headers()).get("x-vercel-ip-country");
  const name = countryName(code);
  return (
    <div className="hero-mesh grain relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground">
      <div className="relative mb-6">
        <Logo />
      </div>
      <div className="foil-edge relative w-full max-w-sm rounded-2xl p-6 shadow-xl shadow-black/40 [--foil-fill:#0b0d13]">
        <h1 className="text-xl font-semibold text-white">
          CardFlip isn&apos;t available in {name ?? "your country"} yet
        </h1>
        <p className="mt-2 text-sm text-zinc-400">We&apos;ll email you once, when CardFlip opens in your country.</p>
        <WaitlistForm />
        <p className="mt-6 text-center text-sm text-zinc-400">
          Already a member?{" "}
          <a href="/login" className={`${TAP_LINK} font-medium text-brand-300 hover:text-brand-200`}>
            Log In
          </a>
        </p>
      </div>
      <p className="mt-4 text-sm text-zinc-400">
        <a href="/privacy" className="inline-block py-3 hover:text-zinc-200">Privacy</a>
        <span className="mx-2">·</span>
        <a href="/terms" className="inline-block py-3 hover:text-zinc-200">Terms</a>
      </p>
    </div>
  );
}
