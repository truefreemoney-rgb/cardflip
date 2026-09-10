"use client";

import { useState } from "react";
import { apiPath } from "@/lib/client/basePath";

/**
 * /admin/social — what the social autopilot would post today, before any
 * account exists (docs/SOCIAL-AUTOPILOT.md). One card per draft: the image
 * at each site size, the caption, a Copy button. Chris looks here, never
 * at the social sites.
 */
export interface DraftView {
  id: string;
  kind: "movers" | "card";
  game: "pokemon" | "mtg";
  day: string;
  title: string;
  caption: string;
  hashtags: string[];
  imagePath: string;
}

const SIZES = [
  ["square", "Square 1080", "aspect-square"],
  ["story", "Story 9:16", "aspect-[9/16]"],
  ["landscape", "Landscape", "aspect-[1200/628]"],
] as const;

export default function SocialPreview({ drafts }: { drafts: DraftView[] }) {
  if (drafts.length === 0) {
    return (
      <p className="rounded-2xl border border-edge bg-surface-1 p-4 text-sm text-zinc-400">
        Nothing to post today: the price history is too thin for a movers list or a card of the day. Try another day above.
      </p>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {drafts.map((d) => (
        <Draft key={d.id} draft={d} />
      ))}
    </div>
  );
}

function Draft({ draft }: { draft: DraftView }) {
  const [size, setSize] = useState<(typeof SIZES)[number][0]>("square");
  const [copied, setCopied] = useState(false);
  const aspect = SIZES.find((s) => s[0] === size)![2];
  const text = `${draft.caption}\n\n${draft.hashtags.map((h) => `#${h}`).join(" ")}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the textarea is selectable */
    }
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-edge bg-surface-1 p-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-white">{draft.title}</h2>
          <p className="text-xs text-zinc-500">
            {draft.game === "mtg" ? "Magic" : "Pokémon"} · {draft.kind === "movers" ? "movers of the week" : "card of the day"} · {draft.day}
          </p>
        </div>
        <div className="flex gap-1">
          {SIZES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSize(key)}
              className={`rounded-full px-2.5 py-1 text-xs ${size === key ? "bg-brand-500/20 text-brand-300" : "text-zinc-400 hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <div className={`mx-auto w-full ${size === "story" ? "max-w-[260px]" : ""} ${aspect} overflow-hidden rounded-xl border border-edge bg-black`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={size}
          src={apiPath(`${draft.imagePath}&size=${size}`)}
          alt={draft.title}
          className="h-full w-full object-contain"
        />
      </div>
      <textarea readOnly value={text} rows={6} className="w-full rounded-xl border border-edge bg-surface-2 p-3 text-sm text-zinc-200" />
      <div className="flex items-center justify-between">
        <a href={apiPath(`${draft.imagePath}&size=${size}`)} target="_blank" rel="noreferrer" className="text-xs text-brand-300 hover:underline">
          Open image
        </a>
        <button type="button" onClick={copy} className="rounded-full bg-brand-500 px-4 py-1.5 text-sm font-medium text-white">
          {copied ? "Copied" : "Copy caption"}
        </button>
      </div>
    </article>
  );
}
