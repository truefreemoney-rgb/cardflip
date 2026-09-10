"use client";

import { useState } from "react";
import { apiPath } from "@/lib/client/basePath";

/**
 * /admin/social — the sites strip: which sites the publisher can post to,
 * when each last posted, and one "Post now" for the day. A site shows
 * "not connected" until its token is on Vercel (Chris's board row).
 */
export interface SiteView {
  site: string;
  label: string;
  connected: boolean;
  lastDay: string | null;
  uris: string[];
}

interface Report {
  sites: Array<{ label: string; status: string; reason?: string; posts: Array<{ title: string; uri?: string; error?: string }> }>;
}

export default function SocialSites({ sites, day, isPostDay }: { sites: SiteView[]; day: string; isPostDay: boolean }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const anyConnected = sites.some((s) => s.connected);

  async function postNow() {
    if (!confirm(`Post today's pictures to every connected site now?`)) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(apiPath(`/api/social/publish?force=1&day=${day}`), { method: "POST" });
      const r = (await res.json()) as Report & { error?: string };
      if (!res.ok) throw new Error(r.error ?? `HTTP ${res.status}`);
      setNote(
        r.sites
          .map((s) => {
            const ok = s.posts.filter((p) => p.uri).length;
            const bad = s.posts.filter((p) => p.error);
            if (s.status === "skipped") return `${s.label}: ${s.reason}`;
            return `${s.label}: ${ok} posted${bad.length ? `, ${bad.length} failed (${bad[0].error})` : ""}`;
          })
          .join(" · "),
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-edge bg-surface-1 px-4 py-3 text-sm">
      {sites.map((s) => (
        <span key={s.site} className="flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${s.connected ? "bg-emerald-400" : "bg-zinc-600"}`} aria-hidden />
          <span className="text-white">{s.label}</span>
          <span className="text-zinc-500">
            {!s.connected ? "not connected" : s.lastDay ? (
              <>
                last post {s.lastDay}
                {s.uris[0] && (
                  <>
                    {" "}
                    <a href={s.uris[0]} target="_blank" rel="noreferrer" className="text-brand-300 hover:underline">
                      open
                    </a>
                  </>
                )}
              </>
            ) : (
              "connected, nothing posted yet"
            )}
          </span>
        </span>
      ))}
      <span className="ml-auto flex items-center gap-3">
        <span className="text-xs text-zinc-500">{isPostDay ? "Posts today with the daily cron." : "Posts Tue / Thu / Sat with the daily cron."}</span>
        <button
          type="button"
          onClick={postNow}
          disabled={busy || !anyConnected}
          className="rounded-full bg-brand-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? "Posting…" : "Post now"}
        </button>
      </span>
      {note && <p className="w-full text-xs text-zinc-300">{note}</p>}
    </div>
  );
}
