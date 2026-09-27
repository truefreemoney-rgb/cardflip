"use client";

import { useRef, useState, type ChangeEvent } from "react";
import Spinner from "@/components/Spinner";
import { apiPath } from "@/lib/client/basePath";
import { shrinkImage } from "@/lib/client/shrinkImage";

/** Photos per ticket, note, or reply (mirrors TICKET_IMAGES_MAX). */
export const TICKET_IMAGES_MAX = 4;

/** Thumbnails on a ticket, note, or reply; tap opens the full photo. */
export function PhotoStrip({ urls, size = "h-16 w-16" }: { urls: string[]; size?: string }) {
  if (urls.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {urls.map((u) => (
        <a key={u} href={u} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-edge">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={u} alt="Photo" className={`${size} object-cover`} loading="lazy" />
        </a>
      ))}
    </div>
  );
}

/**
 * Add photos to a ticket, note, or reply: shrink on the client, upload to
 * Blob, keep the URL. Up to four; the server drops anything past that or
 * from anywhere but our store. `uploadPath` is the seller route by default;
 * the admin panel passes its own (separate session).
 */
export function PhotoPicker({
  urls,
  onChange,
  disabled,
  uploadPath = "/api/help/tickets/image",
}: {
  urls: string[];
  onChange: (urls: string[]) => void;
  disabled?: boolean;
  uploadPath?: string;
}) {
  const [uploading, setUploading] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, TICKET_IMAGES_MAX - urls.length);
    e.target.value = "";
    if (files.length === 0) return;
    setErr(null);
    setUploading((n) => n + files.length);
    const added: string[] = [];
    for (const f of files) {
      try {
        const blob = await shrinkImage(f);
        const form = new FormData();
        form.append("file", blob, f.name.replace(/\.[^.]+$/, "") + (blob.type === "image/jpeg" ? ".jpg" : ""));
        const res = await fetch(apiPath(uploadPath), { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || typeof data.url !== "string") throw new Error(data.error || "Upload failed");
        added.push(data.url);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Couldn't upload that photo");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (added.length) onChange([...urls, ...added].slice(0, TICKET_IMAGES_MAX));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {urls.map((u) => (
          <div key={u} className="relative h-16 w-16 overflow-hidden rounded-lg border border-edge">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt="Photo" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(urls.filter((x) => x !== u))}
              aria-label="Remove photo"
              className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[11px] text-white"
            >
              ✕
            </button>
          </div>
        ))}
        {uploading > 0 && (
          <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-edge bg-surface-2/60">
            <Spinner className="h-4 w-4" />
          </div>
        )}
        {urls.length + uploading < TICKET_IMAGES_MAX && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-edge-strong text-zinc-400 transition hover:border-brand-400 hover:text-white disabled:opacity-40"
          >
            <span className="text-lg leading-none">+</span>
            <span className="text-[10px]">Photo</span>
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={pick} />
      {err && <p className="text-xs text-amber-300">{err}</p>}
    </div>
  );
}

/**
 * One turn of a ticket's chat. The seller's own turns sit on the right in
 * brand colour, the other side's on the left, like the robot chat.
 */
export function ThreadBubble({
  mine,
  who,
  when,
  body,
  images,
}: {
  mine: boolean;
  who: string;
  when: string;
  body: string;
  images: string[];
}) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
          mine ? "rounded-br-md bg-brand-500 text-white" : "rounded-bl-md bg-surface-2 text-zinc-200"
        }`}
      >
        <p className={`text-[11px] ${mine ? "text-white/70" : "text-zinc-500"}`}>
          {who} · {when}
        </p>
        {body && <p className="mt-0.5 whitespace-pre-wrap">{body}</p>}
        <PhotoStrip urls={images} />
      </div>
    </div>
  );
}
