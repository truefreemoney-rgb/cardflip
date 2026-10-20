"use client";

import { displayCardNumber } from "@/lib/games";
import CardImage from "@/components/CardImage";
import StatusChip from "@/components/StatusChip";
import { formatMoney, headlinePrice } from "@/lib/listing";
import { shownDoubt, type ScanItem } from "@/lib/types";

interface Props {
  item: ScanItem;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

export default function QueueRow({ item, selected, onSelect, onRemove }: Props) {
  // The Market price, like every other screen (Chris, 10-02); the listing price is in the editor.
  const price = item.card ? headlinePrice(item) : null;

  return (
    <div
      className={`group relative flex items-center gap-3 rounded-xl border p-2.5 transition ${
        selected
          ? "border-brand-400/60 bg-brand-500/10"
          : "border-transparent hover:border-edge hover:bg-surface-1"
      }`}
    >
      <button
        onClick={onSelect}
        // min-w-0: without it the name can't shrink below its longest word,
        // so on a phone the status chip got clipped ("Check matc") and the ✕
        // hung 20px past the edge with a scrollbar under the queue (09-02).
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <CardImage
          src={item.card?.imageSmall || item.previewUrl}
          alt=""
          className="h-14 w-10 shrink-0 rounded-md object-cover shadow-md shadow-black/40"
        />
        <span className="min-w-0 flex-1">
          {/* Two lines, not one: the longest catalogue names run 51
              characters ("Team Galactic's Invention G-107 Technical
              Machine G") and a phone row fits ~18 per line (Chris, 09-28). */}
          <span className="line-clamp-2 text-sm font-medium leading-snug text-white [overflow-wrap:anywhere]">
            {/* A failed read said "Identifying…" forever (Chris 09-29). */}
            {item.card ? item.card.englishName || item.card.name : item.error ? "Not identified" : "Identifying…"}
            {item.card?.englishName && (
              <span className="text-zinc-500"> ({item.card.englishName})</span>
            )}
          </span>
          <span className="block truncate text-xs text-zinc-500">
            {item.card
              ? // Sealed products have no collector number to show.
                `${item.card.setName}${item.card.number ? ` · ${displayCardNumber(item.card)}` : ""}`
              : (item.error ?? "Reading card")}
          </span>
          {shownDoubt(item.matchDoubt) && (
            <span
              className="mt-0.5 inline-block max-w-full truncate rounded-full border border-amber-400/30 px-2 py-0.5 text-[10px] text-amber-300/90"
              title="The scan wasn't sure, or the match was changed by hand"
            >
              ⚠ {shownDoubt(item.matchDoubt)}
            </span>
          )}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {price != null && (
            <span className="text-sm font-semibold text-emerald-400">
              {formatMoney(price)}
            </span>
          )}
          <StatusChip status={item.status} verified={Boolean(item.verifiedAt)} />
        </span>
      </button>

      {/* A word, not an X (10-14, Jenny tidied her list with the Xs and lost every card): this only takes the
          row off the list, the card stays in Inventory. Deleting lives in the card view, behind a confirm. */}
      <button
        onClick={onRemove}
        aria-label={`Clear ${item.card ? item.card.englishName || item.card.name : "card"} from the list (it stays in your Inventory)`}
        title="Clear from this list. The card stays in your Inventory."
        // before: = 6px above and below, a 44px tap on the 32px pill (review 10-19 #24).
        className="relative flex h-8 shrink-0 items-center rounded-full border border-edge px-2.5 text-xs font-medium text-zinc-400 transition before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] hover:border-edge-strong hover:text-zinc-200 focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
      >
        Clear
      </button>
    </div>
  );
}
