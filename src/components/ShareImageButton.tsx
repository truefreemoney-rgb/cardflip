"use client";

import { useState } from "react";
import { apiPath } from "@/lib/client/basePath";
import { toast } from "@/components/Toaster";

/**
 * "Share" (audit G2): fetches a 1080x1920 picture from /api/share/* and hands it to the
 * phone's share sheet as a file (Web Share API, navigator.canShare({ files })). Where files
 * cannot be shared (desktop, some in-app browsers) the PNG is saved instead.
 * `path` is the API path with its query, e.g. /api/share/card?game=pokemon&id=base1-4.
 */
export default function ShareImageButton({ path, fileName, label = "Share", className = "" }: { path: string; fileName: string; label?: string; className?: string }) {
  const [busy, setBusy] = useState(false);

  async function share() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(apiPath(path), { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const file = new File([blob], `${fileName}.png`, { type: "image/png" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "CardFlip" });
        } catch (err) {
          // Closing the share sheet is not an error.
          if (!(err instanceof DOMException && err.name === "AbortError")) throw err;
        }
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast("Picture saved to your downloads", "info");
    } catch {
      toast("Couldn't make that picture. Try again in a minute.", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void share()}
      disabled={busy}
      className={`inline-flex items-center justify-center rounded-full border border-edge bg-surface-1 px-3.5 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-brand-400 hover:text-white disabled:opacity-60 ${className}`}
    >
      {busy ? "Making Picture…" : label}
    </button>
  );
}
