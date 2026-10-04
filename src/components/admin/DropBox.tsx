"use client";

import { upload } from "@vercel/blob/client";
import { useState } from "react";
import { apiPath } from "@/lib/client/basePath";

/**
 * /admin/drop — pick a file on the phone, it goes straight to the Blob
 * store (the owner's hand-over for big videos, 10-04). One obvious action,
 * a progress bar, then the link to copy.
 */
export default function DropBox() {
  const [pct, setPct] = useState<number | null>(null);
  const [done, setDone] = useState<{ url: string; name: string; bytes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setDone(null);
    setPct(0);
    try {
      const blob = await upload(`drop/${file.name}`, file, {
        access: "public",
        handleUploadUrl: apiPath("/api/admin/drop"),
        multipart: true,
        onUploadProgress: (p) => setPct(Math.round(p.percentage)),
      });
      setDone({ url: blob.url, name: file.name, bytes: file.size });
      setPct(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPct(null);
    } finally {
      e.target.value = "";
    }
  }

  return (
    <div className="rounded-2xl border border-edge bg-surface-1 p-4">
      <label className="flex cursor-pointer items-center justify-center rounded-xl bg-brand-500 px-5 py-4 text-base font-semibold text-white hover:bg-brand-400">
        {pct === null ? "Pick A File To Send" : `Sending… ${pct}%`}
        <input type="file" className="hidden" onChange={onPick} disabled={pct !== null} />
      </label>
      {pct !== null && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-brand-400 transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}
      {done && (
        <div className="mt-3 text-sm">
          <p className="text-emerald-300">
            Sent: {done.name} ({(done.bytes / 1e6).toFixed(1)} MB)
          </p>
          <a href={done.url} className="mt-1 block break-all text-brand-200 hover:text-white" target="_blank" rel="noreferrer">
            {done.url}
          </a>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
    </div>
  );
}
