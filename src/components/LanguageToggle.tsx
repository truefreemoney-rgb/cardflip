"use client";

import type { ScanLanguage } from "@/lib/types";

const OPTIONS: { value: ScanLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ja", label: "Japanese" },
  { value: "zh", label: "Chinese" },
];

interface Props {
  value: ScanLanguage;
  onChange: (lang: ScanLanguage) => void;
}

export default function LanguageToggle({ value, onChange }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Card language"
      className="inline-flex rounded-full border border-edge bg-surface-1 p-1 text-sm"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`rounded-full px-3.5 py-1.5 font-medium transition ${
            value === opt.value
              ? "bg-brand-500 text-white"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
