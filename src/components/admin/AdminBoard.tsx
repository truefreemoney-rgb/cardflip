import type { BoardSection } from "@/lib/server/board";

/**
 * The board (docs/BOARD.md) in the admin console — read-only, one card per
 * category, owner tag per line. Edited in the repo, never here.
 */
export default function AdminBoard({ sections }: { sections: BoardSection[] }) {
  if (sections.length === 0) {
    return <p className="text-sm text-zinc-500">docs/BOARD.md isn&apos;t in this deployment.</p>;
  }
  const tone = (title: string) =>
    /^now/i.test(title)
      ? "border-brand-400/40"
      : /^chris/i.test(title)
        ? "border-amber-400/30"
        : /^claude/i.test(title)
          ? "border-sky-400/30"
          : /^done/i.test(title)
            ? "border-emerald-400/25"
            : "border-edge";
  const ownerChip = (o: "Chris" | "Claude" | "both" | null) =>
    o === "Chris"
      ? "bg-amber-400/15 text-amber-300"
      : o === "Claude"
        ? "bg-sky-400/15 text-sky-300"
        : o === "both"
          ? "bg-violet-400/15 text-violet-300"
          : "";
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {sections.map((s) => {
        const open = s.items.filter((i) => !i.done).length;
        return (
          <section key={s.title} className={`rounded-2xl border bg-surface-1 p-4 ${tone(s.title)}`}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-white">
                {s.title}
                {s.hint && <span className="ml-2 text-xs font-normal text-zinc-500">{s.hint}</span>}
              </h3>
              <span className="text-xs text-zinc-500">{open} open</span>
            </div>
            <ul className="mt-3 space-y-2">
              {s.items.map((it, i) => (
                <li key={i} className={`flex items-start gap-2 text-[13px] leading-snug ${it.done ? "text-zinc-500 line-through decoration-zinc-700" : "text-zinc-200"}`}>
                  <span aria-hidden className={`mt-[3px] h-3.5 w-3.5 shrink-0 rounded border ${it.done ? "border-emerald-400/40 bg-emerald-400/20" : "border-zinc-600"}`} />
                  <span className="min-w-0">
                    {it.owner && (
                      <span className={`mr-1.5 inline-block rounded px-1.5 py-px align-[1px] text-[10px] font-semibold ${ownerChip(it.owner)}`}>{it.owner}</span>
                    )}
                    {it.text}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
