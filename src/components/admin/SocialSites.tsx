"use client";

import { useState } from "react";
import { apiPath } from "@/lib/client/basePath";
import ConfirmHost, { confirmAction } from "@/components/ConfirmDialog";

/**
 * /admin/social — the sites strip: which sites the publisher can post to,
 * when each last posted, and one "Post now" (next unposted slot). A site shows
 * "not connected" until its token is on Vercel (Chris's board row).
 */
export interface SiteView {
  site: string;
  label: string;
  connected: boolean;
  /** OAuth sites only: the route that starts the connect flow, shown while the app keys exist but no account is connected. */
  connectPath: string | null;
  lastDay: string | null;
  uris: string[];
  /** Posted by hand (Pinterest): the robot does not post it, so no "post" link; its last post comes from the posts read. */
  byHand?: boolean;
}

interface Report {
  sites: Array<{ label: string; status: string; reason?: string; posts: Array<{ title: string; uri?: string; error?: string }> }>;
}

/** morningLabel: what the 7am slot posts that day (socialPublish slotLabel), since a trial or a day plan can change it. */
export default function SocialSites({ sites, day, slotNow, notice, morningLabel = "7am set spotlight" }: { sites: SiteView[]; day: string; slotNow: string | null; notice?: string | null; morningLabel?: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(notice ?? null);
  const anyConnected = sites.some((s) => s.connected);

  /** No site = every connected site, only what is still owed (never a slot that already went out, 10-24). A site = that site only, its 7am post, re-posted if it already went out. */
  async function postNow(site?: SiteView) {
    const ask = site
      ? `Post today's ${morningLabel} to ${site.label} only, now? (Re-posts if it already went out.)`
      : `Post whatever is still owed today to every connected site now? A slot that already went out is not posted again.`;
    // The in-app dialog: native confirm() answers false silently in an installed app (review 10-19 admin #7).
    if (!(await confirmAction({ message: ask, confirmLabel: "Post now" }))) return;
    setBusy(true);
    setNote(null);
    try {
      const only = site ? `&site=${encodeURIComponent(site.site)}&slot=morning` : "";
      const res = await fetch(apiPath(`/api/social/publish?force=1&day=${day}${only}`), { method: "POST" });
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
      <ConfirmHost />
      {sites.map((s) => (
        <span key={s.site} className="flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${s.connected ? "bg-emerald-400" : "bg-zinc-600"}`} aria-hidden />
          <span className="text-white">{s.label}</span>
          <span className="text-zinc-500">
            {!s.connected ? (
              s.connectPath ? (
                <a href={apiPath(s.connectPath)} className="text-brand-300 hover:underline">
                  connect
                </a>
              ) : (
                "not connected"
              )
            ) : s.lastDay ? (
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
            {s.connected &&
              (s.byHand ? (
                " · by hand"
              ) : (
                <>
                  {" · "}
                  <button type="button" onClick={() => postNow(s)} disabled={busy} className="text-brand-300 hover:underline disabled:opacity-40">
                    post
                  </button>
                </>
              ))}
          </span>
        </span>
      ))}
      <span className="ml-auto flex items-center gap-3">
        <span className="text-xs text-zinc-500">{slotNow ? `In the ${slotNow} window now.` : "Posts 7am / 1pm / 7pm ET on their own."}</span>
        <button
          type="button"
          onClick={() => postNow()}
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
