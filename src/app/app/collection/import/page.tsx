"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import PageSkeleton from "@/components/PageSkeleton";
import { useSession } from "@/components/SessionProvider";
import { toast } from "@/components/Toaster";
import { apiPath } from "@/lib/client/basePath";
import { formatMoney } from "@/lib/listing";

/**
 * Import from other apps (Tier 2 #12, 09-27): a Collectr / TCGplayer /
 * TCG Collector CSV → review what we matched → one tap → it is in the
 * collection, priced. Three screens, one action each: choose the file,
 * check the list, done.
 */

interface PreviewRow {
  line: number;
  input: string;
  status: "ok" | "check" | "skip";
  reason: string | null;
  quantity: number;
  condition: string;
  catalogCardId: string | null;
  name: string | null;
  setName: string | null;
  number: string | null;
  imageUrl: string | null;
  price: number;
  paid: number | null;
  firstEdition: boolean;
}

interface Preview {
  columns: Record<string, string>;
  rows: PreviewRow[];
  cards: number;
  matched: number;
  doubtful: number;
  skipped: number;
  value: number;
  truncated: boolean;
}

export default function ImportPage() {
  const { status } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [omit, setOmit] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  if (status !== "ready") return <PageSkeleton />;

  async function choose(file: File) {
    setError(null);
    setPreview(null);
    setDone(null);
    setOmit(new Set());
    setFileName(file.name);
    const text = await file.text();
    setCsv(text);
    setBusy("preview");
    try {
      const r = await fetch(apiPath("/api/cards/import"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv: text }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn't read that file.");
      setPreview(j.preview as Preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!preview) return;
    setBusy("commit");
    setError(null);
    try {
      const r = await fetch(apiPath("/api/cards/import"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv, commit: true, omit: [...omit] }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "The import failed — nothing was added.");
      setDone(j.created as number);
      toast(`${j.created} card${j.created === 1 ? "" : "s"} imported`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The import failed — nothing was added.");
    } finally {
      setBusy(null);
    }
  }

  const toggle = (line: number) =>
    setOmit((s) => {
      const next = new Set(s);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });

  const live = preview ? preview.rows.filter((r) => r.status !== "skip") : [];
  const skipped = preview ? preview.rows.filter((r) => r.status === "skip") : [];
  const willImport = live.filter((r) => !omit.has(r.line)).reduce((n, r) => n + r.quantity, 0);
  const willValue = live.filter((r) => !omit.has(r.line)).reduce((n, r) => n + r.price * r.quantity, 0);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8 sm:px-6">
      <div>
        <Link href="/app/collection" className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline">
          ← Inventory
        </Link>
        <h1 className="mt-1 font-display text-2xl font-semibold text-white">Import from another app</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Export your collection as a CSV from Collectr, TCGplayer or TCG Collector, drop it here, and every card lands in your inventory at today&apos;s price.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv,text/plain,.txt,.tsv"
        className="sr-only"
        data-testid="import-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void choose(f);
          e.target.value = "";
        }}
      />

      {done != null ? (
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-5 py-8 text-center">
          <p className="font-display text-3xl font-semibold text-white">{done}</p>
          <p className="mt-1 text-sm text-emerald-200">card{done === 1 ? "" : "s"} added to your inventory</p>
          <Link
            href="/app/collection"
            className="mt-5 inline-block rounded-full bg-brand-500 px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/30 transition hover:bg-brand-400"
          >
            See them in Inventory
          </Link>
          <p className="mt-4 text-xs text-zinc-500">
            Prices refresh daily with the market. Add your own photo to a card before listing it on eBay.
          </p>
        </div>
      ) : !preview ? (
        <div className="rounded-2xl border border-edge bg-surface-1 p-5">
          <button
            type="button"
            disabled={busy === "preview"}
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-edge-strong bg-black/20 px-4 py-8 text-center transition hover:border-brand-400 disabled:opacity-60"
          >
            <span className="text-3xl" aria-hidden>📄</span>
            <span className="text-base font-semibold text-white">{busy === "preview" ? "Reading your file…" : "Choose your CSV file"}</span>
            <span className="text-xs text-zinc-500">Nothing is added until you check the list on the next screen</span>
          </button>
          {error && (
            <p role="alert" className="mt-3 text-sm font-medium text-amber-300">
              {error}
            </p>
          )}
          <div className="mt-5 grid gap-3 text-xs text-zinc-500 sm:grid-cols-3">
            <div>
              <p className="font-semibold text-zinc-300">Collectr</p>
              <p>Portfolio → ⋯ → Export (Pro). Save the CSV.</p>
            </div>
            <div>
              <p className="font-semibold text-zinc-300">TCGplayer</p>
              <p>Collection → Export. The TCGplayer Id column makes matches exact.</p>
            </div>
            <div>
              <p className="font-semibold text-zinc-300">Anything else</p>
              <p>A sheet with Name, Set, Number, Condition and Quantity columns works.</p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-edge bg-surface-1 px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="truncate text-sm text-zinc-300">
                <span className="font-semibold text-white">{fileName}</span>
                <span className="text-zinc-500"> · {preview.matched} matched{preview.doubtful ? ` · ${preview.doubtful} to check` : ""}{preview.skipped ? ` · ${preview.skipped} skipped` : ""}</span>
              </p>
              <button type="button" onClick={() => inputRef.current?.click()} className="text-xs text-zinc-400 underline decoration-zinc-600 underline-offset-2 hover:text-zinc-200">
                Different file
              </button>
            </div>
            {preview.truncated && <p className="mt-1 text-xs text-amber-300">One import takes up to 500 cards — import the rest from a second file.</p>}
          </div>

          {live.length === 0 ? (
            <div className="rounded-2xl border border-edge bg-surface-1 px-4 py-8 text-center text-sm text-zinc-400">
              None of these rows matched a card we know. Check the skipped list below for why.
            </div>
          ) : (
            <ul className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface-1">
              {live.map((r) => {
                const off = omit.has(r.line);
                return (
                  <li key={r.line} className={`flex items-center gap-3 px-3 py-2 ${off ? "opacity-40" : ""}`}>
                    <input
                      type="checkbox"
                      checked={!off}
                      onChange={() => toggle(r.line)}
                      aria-label={`Import ${r.name ?? r.input}`}
                      className="h-5 w-5 shrink-0 accent-brand-500"
                    />
                    {r.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.imageUrl} alt="" className="h-12 w-9 shrink-0 rounded object-cover" loading="lazy" />
                    ) : (
                      <span className="h-12 w-9 shrink-0 rounded bg-black/30" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-zinc-100">
                        {r.name}
                        {r.quantity > 1 && <span className="ml-1.5 text-xs text-zinc-500">×{r.quantity}</span>}
                      </div>
                      <div className="truncate text-xs text-zinc-500">
                        {r.setName} · #{r.number} · {r.condition}
                      </div>
                      {r.status === "check" && <div className="mt-0.5 truncate text-xs text-amber-300">{r.reason}</div>}
                    </div>
                    <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-white">{r.price > 0 ? formatMoney(r.price) : "—"}</span>
                  </li>
                );
              })}
            </ul>
          )}

          {skipped.length > 0 && (
            <div className="rounded-2xl border border-edge bg-surface-1 px-4 py-3">
              <button type="button" onClick={() => setShowSkipped((v) => !v)} className="text-xs font-medium text-zinc-400 hover:text-zinc-200">
                {showSkipped ? "Hide" : "Show"} {skipped.length} skipped row{skipped.length === 1 ? "" : "s"}
              </button>
              {showSkipped && (
                <ul className="mt-2 divide-y divide-edge text-xs">
                  {skipped.map((r) => (
                    <li key={r.line} className="flex justify-between gap-3 py-1.5">
                      <span className="truncate text-zinc-300">{r.input}</span>
                      <span className="shrink-0 text-zinc-500">{r.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm font-medium text-amber-300">
              {error}
            </p>
          )}

          <div className="sticky bottom-0 -mx-4 border-t border-edge bg-black/80 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0">
            <button
              type="button"
              disabled={busy === "commit" || willImport === 0}
              onClick={() => void commit()}
              className="sheen w-full rounded-full bg-brand-500 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-500/30 transition hover:bg-brand-400 disabled:opacity-50"
            >
              {busy === "commit" ? "Importing…" : `Import ${willImport} card${willImport === 1 ? "" : "s"}${willValue > 0 ? ` · ${formatMoney(willValue)}` : ""}`}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
