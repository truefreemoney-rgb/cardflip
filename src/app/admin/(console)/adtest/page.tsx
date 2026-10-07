import Link from "next/link";
import { requireOwnerPage } from "@/lib/server/adminPage";
import { parseRange, RANGES } from "@/lib/server/analytics";
import { AD_SOURCES, getAdTest, type AdSource, type AdTestRow } from "@/lib/server/adTest";
import { num } from "@/components/admin/format";

export const dynamic = "force-dynamic";

/**
 * /admin/adtest — the /scan vs home split test (10-06, Chris). One card per ad source, the two landing
 * pages side by side, every funnel step as a count and a share of that page's visitors. Phone-first,
 * server-rendered, read-only (lib/server/adTest.ts).
 */

const SOURCE_LABEL: Record<AdSource, string> = { googleads: "Google Ads", tiktok: "TikTok", other: "Everything else" };

const STEPS: { key: keyof AdTestRow; label: string }[] = [
  { key: "visitors", label: "Visitors" },
  { key: "stay10", label: "Stayed 10 seconds" },
  { key: "tapped", label: "Tapped anything" },
  { key: "priced", label: "Saw a card price" },
  { key: "signupTap", label: "Tapped Sign Up" },
  { key: "signupPage", label: "Opened the signup page" },
  { key: "accounts", label: "Made an account" },
  { key: "paid", label: "Paid" },
];

function Cell({ row, k }: { row: AdTestRow; k: keyof AdTestRow }) {
  const v = row[k];
  if (v === null || typeof v !== "number") return <td className="px-2 py-2 text-right text-zinc-600">—</td>;
  const pct = k !== "visitors" && row.visitors > 0 ? Math.round((v / row.visitors) * 100) : null;
  return (
    <td className="px-2 py-2 text-right tabular-nums">
      <span className="font-semibold text-white">{num(v)}</span>
      {pct !== null && <span className="ml-1.5 text-xs text-zinc-500">{pct}%</span>}
    </td>
  );
}

export default async function AdTestPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireOwnerPage();
  const range = parseRange((await searchParams).range);
  const hours = RANGES.find((r) => r.id === range)!.hours;
  const rows = await getAdTest(hours);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pb-20">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Ad Test: /scan vs Home</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Same ads, two landing pages. Percent = share of that page&apos;s visitors. Accounts count by when they signed up.
        </p>
      </div>
      {AD_SOURCES.map((source) => {
        const scan = rows.find((r) => r.source === source && r.landing === "/scan")!;
        const home = rows.find((r) => r.source === source && r.landing === "/")!;
        return (
          <section key={source} className="overflow-hidden rounded-2xl border border-edge bg-surface-1">
            <h2 className="border-b border-edge px-3 py-2.5 font-display text-lg font-semibold text-white">{SOURCE_LABEL[source]}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-zinc-500">
                  <th className="px-3 py-2 text-left font-medium">Step</th>
                  <th className="px-2 py-2 text-right font-medium">/scan</th>
                  <th className="px-2 py-2 text-right font-medium">Home</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge/60">
                {STEPS.map((s) => (
                  <tr key={s.key}>
                    <td className="px-3 py-2 text-zinc-300">{s.label}</td>
                    <Cell row={scan} k={s.key} />
                    <Cell row={home} k={s.key} />
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      <p className="text-xs text-zinc-500">
        Home tracks taps and 10-second stays from Oct 6, 2026 10 PM ET; earlier home rows show zero there. Home has no price step.
      </p>
      <nav aria-label="Range" className="fixed inset-x-0 bottom-0 z-30 flex justify-center gap-1 border-t border-edge bg-background/95 px-4 py-2.5 backdrop-blur">
        {RANGES.map((r) => (
          <Link
            key={r.id}
            href={`/admin/adtest?range=${r.id}`}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${r.id === range ? "bg-brand-500 text-white" : "border border-edge text-zinc-300"}`}
          >
            {r.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
