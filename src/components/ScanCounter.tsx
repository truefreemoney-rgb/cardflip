"use client";

import Link from "next/link";
import type { SessionUser } from "@/lib/client/auth";

/**
 * Header scan counter (Chris, 09-07: "a scan counter and total remaining
 * scans left for users to easily keep track of scans, also if you click on
 * it, should lead to buying more scans"). Reads the session's scan snapshot
 * (server truth from /api/auth/me, patched after every scan by the scanner)
 * and links to /pricing — there are no scan packs (Chris, 09-01), so "more
 * scans" means the next plan up. Owner/unlimited accounts see their count
 * with no link. Turns amber at 10% left, red at zero.
 */
export default function ScanCounter({ user }: { user: SessionUser }) {
  const scans = user.scans;
  if (!scans) return null;
  const fmt = (n: number) => n.toLocaleString("en-US");

  if (scans.remaining == null) {
    return (
      <span
        title="Unlimited scans on this account"
        className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-edge px-2.5 py-1 text-xs font-medium text-zinc-400"
      >
        <ScanIcon />
        {fmt(scans.used)} scans
        <span className="hidden sm:inline">· unlimited</span>
      </span>
    );
  }

  const period = user.tier === "trial" ? "free scans" : user.tier === "legacy" ? "today" : "this month";
  const low = scans.remaining <= Math.max(1, Math.round(scans.included * 0.1));
  const out = scans.remaining <= 0;
  const tone = out
    ? "border-red-400/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
    : low
      ? "border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20"
      : "border-edge bg-black/25 text-zinc-300 hover:border-edge-strong hover:text-white";
  const title = out
    ? `No scans left ${period === "free scans" ? "on the free trial" : period} — get more`
    : `${fmt(scans.remaining)} of ${fmt(scans.included)} ${period} left${scans.bonus ? ` (includes ${fmt(scans.bonus)} bonus)` : ""} — tap for more scans`;

  return (
    <Link
      href="/pricing"
      title={title}
      aria-label={title}
      data-tour="scans"
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums transition ${tone}`}
    >
      <ScanIcon />
      {out ? (
        <span>Get more scans</span>
      ) : (
        <>
          <span>{fmt(scans.remaining)}</span>
          <span className="font-normal opacity-70">
            / {fmt(scans.included)}
            <span className="hidden sm:inline"> {period === "free scans" ? "free" : "scans"}</span>
          </span>
        </>
      )}
    </Link>
  );
}

function ScanIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 opacity-80" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M3 7V4.5A1.5 1.5 0 0 1 4.5 3H7M13 3h2.5A1.5 1.5 0 0 1 17 4.5V7M17 13v2.5a1.5 1.5 0 0 1-1.5 1.5H13M7 17H4.5A1.5 1.5 0 0 1 3 15.5V13" strokeLinecap="round" />
      <path d="M5 10h10" strokeLinecap="round" />
    </svg>
  );
}
