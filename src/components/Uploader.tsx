"use client";

import { useRef, useState } from "react";

interface Props {
  onFiles: (files: File[]) => void;
  variant?: "hero" | "compact";
}

export default function Uploader({ onFiles, variant = "hero" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handle(list: FileList | null) {
    if (!list) return;
    const files = Array.from(list).filter((f) => f.type.startsWith("image/"));
    if (files.length > 0) onFiles(files);
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      multiple
      className="sr-only"
      onChange={(e) => {
        handle(e.target.files);
        e.target.value = "";
      }}
    />
  );

  if (variant === "compact") {
    return (
      <>
        <button
          onClick={() => inputRef.current?.click()}
          className="rounded-full border border-edge bg-surface-1 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-edge-strong hover:bg-surface-2"
        >
          Add more cards
        </button>
        {input}
      </>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handle(e.dataTransfer.files);
      }}
      className={`flex w-full max-w-lg flex-col items-center gap-5 rounded-3xl border-2 border-dashed p-12 text-center transition-all duration-300 ${
        dragOver
          ? "scale-[1.01] border-brand-400 bg-brand-500/10"
          : "border-white/12 bg-surface-1"
      }`}
    >
      <div className="relative">
        <span
          className="absolute inset-0 rounded-2xl bg-brand-500/30 animate-pulse-ring"
          aria-hidden
        />
        <div
          className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400/25 to-violet-600/25 text-3xl"
          aria-hidden
        >
          📷
        </div>
      </div>

      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold text-white">
          Drop your cards in
        </h2>
        <p className="text-sm leading-relaxed text-zinc-400">
          Add as many photos as you like — CardFlip reads each one, prices it,
          and builds the listing while you keep scanning.
        </p>
      </div>

      <button
        onClick={() => inputRef.current?.click()}
        className="rounded-full bg-brand-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition hover:-translate-y-0.5 hover:bg-brand-400"
      >
        Choose photos
      </button>

      <p className="text-xs text-zinc-600">
        Or drag and drop · JPG, PNG, HEIC
      </p>
      {input}
    </div>
  );
}
