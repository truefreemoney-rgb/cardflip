"use client";

import type { GameId } from "@/lib/types";

import { useState } from "react";
import { apiPath } from "@/lib/client/basePath";
import { POST_GAME_NAMES } from "@/lib/socialPlan";

/**
 * /admin/social — what the social autopilot would post today, before any
 * account exists (docs/SOCIAL-AUTOPILOT.md). One card per draft: the image
 * at each site size, the caption, a Copy button. Chris looks here, never
 * at the social sites.
 */
export interface DraftView {
  id: string;
  kind: "movers" | "card" | "dips" | "set" | "games";
  game: GameId;
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

/** When a kind goes live that day (socialPublish.ts slotSchedule); a kind missing from it does not post. */
export type Schedule = Partial<Record<DraftView["kind"], { slot: string; when: string; past: boolean }>>;

/** videos: draft id → public MP4 URL, for drafts the render job registered (the 1pm movers go out as video). */
export default function SocialPreview({ drafts, videos = {}, schedule = {} }: { drafts: DraftView[]; videos?: Record<string, string>; schedule?: Schedule }) {
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
        <Draft key={d.id} draft={d} video={videos[d.id]} goesLive={schedule[d.kind]} />
      ))}
    </div>
  );
}

/** "Goes Live Wed, Sep 30 · 7:05am ET" on top of each card; a spare draft says it does not post. */
function GoesLive({ at, video }: { at?: Schedule[keyof Schedule]; video: boolean }) {
  if (!at) return <p className="text-xs font-medium text-zinc-500">Not Posting This Day</p>;
  return (
    <p className={`text-xs font-medium ${at.past ? "text-zinc-400" : "text-brand-300"}`}>
      {at.past ? "Went Live" : "Goes Live"} {at.when}
      {video ? " · as the video" : ""}
    </p>
  );
}

type Size = (typeof SIZES)[number][0] | "video";

function Draft({ draft, video, goesLive }: { draft: DraftView; video?: string; goesLive?: Schedule[keyof Schedule] }) {
  const [size, setSize] = useState<Size>(video ? "video" : "square");
  const [copied, setCopied] = useState(false);
  const aspect = size === "video" ? "aspect-[9/16]" : SIZES.find((s) => s[0] === size)![2];
  const imageSize = size === "video" ? "story" : size;
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
          <GoesLive at={goesLive} video={draft.kind === "movers"} />
          <h2 className="font-semibold text-white">{draft.title}</h2>
          <p className="text-xs text-zinc-500">
            {draft.kind === "games" ? "Every game" : POST_GAME_NAMES[draft.game]} · {draft.kind === "movers" ? "movers of the week" : draft.kind === "dips" ? "price drops this week" : draft.kind === "set" ? "set spotlight" : draft.kind === "games" ? "one scanner, every game" : "card of the day"} · {draft.day}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {video && (
            <button
              type="button"
              onClick={() => setSize("video")}
              className={`rounded-full px-2.5 py-1 text-xs ${size === "video" ? "bg-brand-500/20 text-brand-300" : "text-zinc-400 hover:text-white"}`}
            >
              Video
            </button>
          )}
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
      <div className={`mx-auto w-full ${size === "story" || size === "video" ? "max-w-[260px]" : ""} ${aspect} overflow-hidden rounded-xl border border-edge bg-black`}>
        {size === "video" && video ? (
          <video src={video} controls playsInline muted loop preload="metadata" className="h-full w-full object-contain" />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={size}
            src={apiPath(`${draft.imagePath}&size=${imageSize}`)}
            alt={draft.title}
            className="h-full w-full object-contain"
          />
        )}
      </div>
      <textarea readOnly value={text} rows={6} className="w-full rounded-xl border border-edge bg-surface-2 p-3 text-sm text-zinc-200" />
      <div className="flex items-center justify-between">
        <a href={size === "video" && video ? video : apiPath(`${draft.imagePath}&size=${imageSize}`)} target="_blank" rel="noreferrer" className="text-xs text-brand-300 hover:underline">
          {size === "video" ? "Open video" : "Open image"}
        </a>
        <button type="button" onClick={copy} className="rounded-full bg-brand-500 px-4 py-1.5 text-sm font-medium text-white">
          {copied ? "Copied" : "Copy caption"}
        </button>
      </div>
    </article>
  );
}
