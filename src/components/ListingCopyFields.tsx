"use client";

import type { ListingDraft, ScanItem } from "@/lib/types";

interface Props {
  item: Pick<ScanItem, "titleOverride" | "descriptionOverride">;
  /** The copy as generated, before the seller's edits. */
  generated: ListingDraft;
  /** The copy that will actually post (overrides applied). */
  listing: ListingDraft;
  onChange: (patch: Partial<ScanItem>) => void;
}

/**
 * The listing title + description, editable. These used to be read-only —
 * every competitor (including eBay's own form) lets the seller reword the
 * copy, and "your listing, your words" is table stakes. Edits stick until
 * reset; an untouched field keeps regenerating as condition/price change.
 */
export default function ListingCopyFields({ item, generated, listing, onChange }: Props) {
  const titleEdited = item.titleOverride != null;
  const descriptionEdited = item.descriptionOverride != null;

  return (
    <>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
        <span className="flex items-baseline justify-between">
          Listing title
          {titleEdited && (
            <button
              type="button"
              onClick={() => onChange({ titleOverride: null })}
              className="text-[11px] font-medium text-brand-300 hover:text-brand-200"
            >
              Edited — reset to generated
            </button>
          )}
        </span>
        <input
          value={listing.title}
          maxLength={80}
          onChange={(e) =>
            onChange({
              titleOverride: e.target.value === generated.title ? null : e.target.value,
            })
          }
          className="rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-zinc-200 outline-none transition focus:border-brand-400"
        />
        <span
          className={`text-[11px] ${listing.title.length >= 80 ? "text-amber-400" : "text-zinc-600"}`}
        >
          {listing.title.length}/80 characters
        </span>
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
        <span className="flex items-baseline justify-between">
          Description
          {descriptionEdited && (
            <button
              type="button"
              onClick={() => onChange({ descriptionOverride: null })}
              className="text-[11px] font-medium text-brand-300 hover:text-brand-200"
            >
              Edited — reset to generated
            </button>
          )}
        </span>
        <textarea
          value={listing.description}
          onChange={(e) =>
            onChange({
              descriptionOverride:
                e.target.value === generated.description ? null : e.target.value,
            })
          }
          className="min-h-36 resize-y rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm leading-relaxed text-zinc-200 outline-none transition focus:border-brand-400"
        />
      </label>
    </>
  );
}
