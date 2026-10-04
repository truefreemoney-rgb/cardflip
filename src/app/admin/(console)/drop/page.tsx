import { list } from "@vercel/blob";
import DropBox from "@/components/admin/DropBox";
import { requireOwnerPage } from "@/lib/server/adminPage";

export const dynamic = "force-dynamic";

/**
 * /admin/drop — the owner's file drop (Chris 10-04): a big video off the phone
 * goes straight to the Blob store, and the page lists what has been dropped
 * with a link for each. Owner only; nothing a customer can reach.
 */
export default async function AdminDropPage() {
  await requireOwnerPage();
  const drops = process.env.BLOB_READ_WRITE_TOKEN ? (await list({ prefix: "drop/", limit: 50 })).blobs.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime()) : [];
  return (
    <section>
      <div className="mb-3">
        <h1 className="text-2xl font-semibold text-white">File Drop</h1>
        <p className="text-sm text-zinc-400">Send a file from this phone to Claude. Videos of any size go straight to our storage.</p>
      </div>
      <DropBox />
      {drops.length > 0 && (
        <ul className="mt-4 space-y-2 text-sm">
          {drops.map((b) => (
            <li key={b.url} className="rounded-xl border border-edge bg-surface-1 px-3 py-2">
              <a href={b.url} className="break-all text-brand-200 hover:text-white" target="_blank" rel="noreferrer">
                {b.pathname.replace(/^drop\//, "")}
              </a>
              <span className="ml-2 text-zinc-500">
                {(b.size / 1e6).toFixed(1)} MB · {b.uploadedAt.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
