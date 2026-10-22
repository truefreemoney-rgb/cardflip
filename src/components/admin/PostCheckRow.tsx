"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import { useRouter } from "next/navigation";
import { apiPath } from "@/lib/client/basePath";

interface Props {
  day: string;
  slot: string;
  past: boolean;
  game: string;
  cardId: string;
  variant: string;
  label: string;
  price: number;
  soldUrl: string;
  status: "fixed" | "ok" | "unchecked";
  fixedUsd?: number;
}

const usd = (v: number) => formatMoney(v);

/**
 * One card of a post on /admin/prices: open eBay sold, then "Looks right", or
 * type what it sold for and "Fix" (the price is fixed everywhere, posts show
 * the card at that price with no % change, the video is remade if it has not
 * gone out; 10-21, social.ts postChecks).
 */
export default function PostCheckRow(p: Props) {
  const router = useRouter();
  const [sold, setSold] = useState("");
  const [count, setCount] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function send(action: "ok" | "fix" | "undo") {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(apiPath("/api/admin/post-check"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, game: p.game, cardId: p.cardId, variant: p.variant, day: p.day, slot: p.slot, label: p.label, price: p.price, usd: Number(sold), n: count ? Number(count) : 0 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't save.");
      if (action === "fix" && data.agreed) setNote(`eBay sold agrees with our price (${usd(data.ours)}): marked Looks right${data.remade ? ". The video is being remade (about 6 minutes)" : ""}.`);
      else if (action === "fix") setNote(data.remade ? "Fixed. The video is being remade (about 6 minutes)." : data.remakeError ? `Fixed, but the video could not be remade: ${data.remakeError}` : "Fixed.");
      router.refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  const btn = "rounded-full px-3 py-1 text-xs font-medium transition disabled:opacity-40";
  const priceOk = Number(sold) > 0;
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium text-white">{p.label}</span>
        <span className="text-xs text-zinc-500">{p.variant}</span>
        <span className="tabular-nums text-white">{usd(p.price)}</span>
        <a href={p.soldUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-sky-300 hover:underline">
          eBay sold
        </a>
        {p.status === "fixed" && <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-xs text-amber-300">Fixed to {usd(p.fixedUsd ?? 0)}, posts use this price</span>}
        {p.status === "ok" && <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-xs text-emerald-300">Checked, looks right</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {p.status === "unchecked" ? (
          <>
            <button onClick={() => send("ok")} disabled={busy} className={`${btn} bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20`}>
              Looks right
            </button>
            <span className="hidden text-xs text-zinc-500 sm:inline">or sold for</span>
            <input
              inputMode="decimal"
              value={sold}
              onChange={(e) => setSold(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="sold $"
              aria-label="eBay sold price"
              className="w-20 rounded-lg border border-edge bg-black/30 px-2 py-1 text-base text-zinc-100 sm:text-xs outline-none focus:border-brand-400/60"
            />
            <input
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
              placeholder="sales"
              aria-label="How many sales"
              className="w-16 rounded-lg border border-edge bg-black/30 px-2 py-1 text-base text-zinc-100 sm:text-xs outline-none focus:border-brand-400/60"
            />
            <button onClick={() => send("fix")} disabled={busy || !priceOk} className={`${btn} bg-red-400/10 text-red-300 hover:bg-red-400/20`}>
              {busy ? "…" : "Fix"}
            </button>
          </>
        ) : (
          <button onClick={() => send("undo")} disabled={busy} className={`${btn} bg-white/5 text-zinc-300 hover:bg-white/10`}>
            {busy ? "…" : "Undo"}
          </button>
        )}
      </div>
      {note && <p className="mt-1.5 text-xs text-zinc-400">{note}</p>}
    </li>
  );
}
