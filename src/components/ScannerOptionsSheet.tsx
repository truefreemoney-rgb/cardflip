"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import GameToggle from "@/components/GameToggle";
import Sheet from "@/components/Sheet";
import { CONDITIONS } from "@/lib/listing";
import { readSavedCondition, saveCondition } from "@/lib/client/scanPrefs";
import type { Condition, GameId } from "@/lib/types";

/**
 * The scanner's "⋯" sheet (10-15, after TCGplayer's options menu, done our
 * way): one place for everything that is not Capture. Game (the same chips as
 * under the viewfinder, bigger), the condition new scans start as, the camera
 * light and tips, Share (the phone's own share sheet with a plain link) and
 * Help. No search and no pause (Chris 10-15: "we want people to scan"; pause
 * waits for auto-scans). Every tap applies at once; Done just closes.
 */
interface Props {
  game: GameId | null;
  onGameChange?: (game: GameId) => void;
  torch: "unavailable" | "off" | "on";
  onToggleTorch: () => void;
  tipsOn: boolean;
  onTips: (on: boolean) => void;
  onClose: () => void;
}

const SITE = "https://cardflip.io";

/** The chip dot and ring per condition: the same ladder as the result card and "This copy". */
const DOT: Record<Condition, string> = {
  "Near Mint": "bg-emerald-400",
  "Lightly Played": "bg-sky-400",
  "Moderately Played": "bg-amber-400",
  "Heavily Played": "bg-orange-400",
  Damaged: "bg-red-400",
};
const RING: Record<Condition, string> = {
  "Near Mint": "border-emerald-400 bg-emerald-400/15 text-white",
  "Lightly Played": "border-sky-400 bg-sky-400/15 text-white",
  "Moderately Played": "border-amber-400 bg-amber-400/15 text-white",
  "Heavily Played": "border-orange-400 bg-orange-400/15 text-white",
  Damaged: "border-red-400 bg-red-400/15 text-white",
};
const OFF = "border-edge bg-surface-2 text-zinc-300 hover:border-edge-strong";

function Heading({ children }: { children: string }) {
  return <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500 first:mt-0">{children}</p>;
}

/** A row with a label on the left and a switch (or a given control) on the right. */
function Row({ label, hint, on, onChange, children }: { label: string; hint?: string; on?: boolean; onChange?: () => void; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-edge py-3 last:border-b-0">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-white">{label}</span>
        {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      </span>
      {children ??
        (onChange && (
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={label}
            onClick={onChange}
            className={`relative h-7 w-12 shrink-0 rounded-full border transition ${on ? "border-brand-400 bg-brand-500" : "border-edge bg-surface-2"}`}
          >
            <span className={`absolute top-0.5 h-[22px] w-[22px] rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} aria-hidden />
          </button>
        ))}
    </div>
  );
}

export default function ScannerOptionsSheet({ game, onGameChange, torch, onToggleTorch, tipsOn, onTips, onClose }: Props) {
  const [condition, setCondition] = useState<Condition>(() => readSavedCondition());
  const [shared, setShared] = useState<"" | "copied" | "failed">("");

  async function share() {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "CardFlip", text: "Scan a card, see what it is worth.", url: SITE });
        return;
      }
    } catch (e) {
      // Closing the phone's share sheet is not a failure.
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(SITE);
      setShared("copied");
    } catch {
      setShared("failed");
    }
  }

  const shareHint = shared === "copied" ? "Link copied: cardflip.io" : shared === "failed" ? "Could not share. The link is cardflip.io" : "Send a friend the link";

  return (
    <Sheet
      title="Scanner options"
      onClose={onClose}
      backId="scanner-options"
      footer={
        <button type="button" onClick={onClose} className="w-full rounded-full bg-brand-500 py-3 text-sm font-semibold text-white transition hover:bg-brand-400">
          Done
        </button>
      }
    >
      {game && onGameChange && (
        <>
          <Heading>Game</Heading>
          <div className="mt-2">
            <GameToggle game={game} onChange={onGameChange} block wrap />
          </div>
        </>
      )}

      <Heading>New scans start as</Heading>
      <div className="mt-2 flex flex-wrap gap-2">
        {CONDITIONS.map((c) => {
          const on = condition === c;
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setCondition(c);
                saveCondition(c);
              }}
              className={`flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition ${on ? RING[c] : OFF}`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[c]}`} aria-hidden />
              {c}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-zinc-500">The photo can still change it, and you can change any card after.</p>

      <Heading>Camera</Heading>
      <div>
        {torch !== "unavailable" && <Row label="Light" hint="For a dark room. Glare hurts more than dark on foils." on={torch === "on"} onChange={onToggleTorch} />}
        <Row label="Tips under the camera" hint="Lay It Flat · No Glare · Sleeves OK, No Slabs" on={tipsOn} onChange={() => onTips(!tipsOn)} />
      </div>

      <Heading>Share</Heading>
      <Row label="Share CardFlip" hint={shareHint}>
        <button type="button" onClick={share} className="shrink-0 rounded-full border border-edge bg-surface-2 px-4 py-2 text-sm font-semibold text-white transition hover:border-edge-strong">
          Share
        </button>
      </Row>

      <Heading>Help</Heading>
      <Row label="Scanning help" hint="How to scan, what it reads, what to do when it misses">
        {/* New tab (10-22): leaving the page dropped the scan queue. */}
        <Link href="/app/help" target="_blank" rel="noopener" className="shrink-0 rounded-full border border-edge bg-surface-2 px-4 py-2 text-sm font-semibold text-white transition hover:border-edge-strong">
          Open
        </Link>
      </Row>
    </Sheet>
  );
}
