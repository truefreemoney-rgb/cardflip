import { NextResponse } from "next/server";
import { requireUser, AuthError, subscriptionGate } from "@/lib/server/auth";
import { previewImport, commitImport, MAX_CSV_BYTES } from "@/lib/server/collectionImport";
import { giveBackScans, reserveScans, scanQuota, type ScanQuota, type ScanReservation } from "@/lib/server/scanQuota";

/**
 * Import from other apps (Tier 2 #12): POST { csv, commit?, omit? }.
 * commit false (default) = preview only; true = create the rows.
 * `omit` = file line numbers the seller unticked in the review.
 *
 * Every imported card is one scan on the allowance (Chris, 09-27: "if they
 * import, I want each card to count as a scan"): the preview is capped at
 * the balance, the commit records the count, and zero left is a 402 like
 * the scanner's.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const wall = subscriptionGate(user);
    if (wall) return wall;
    const body = await req.json().catch(() => null);
    const csv = typeof body?.csv === "string" ? body.csv : "";
    if (!csv.trim()) return NextResponse.json({ error: "Choose a CSV file first." }, { status: 400 });
    if (csv.length > MAX_CSV_BYTES) return NextResponse.json({ error: "That file is too big — split it under 1 MB." }, { status: 413 });
    const omit = Array.isArray(body?.omit) ? body.omit.filter((n: unknown): n is number => typeof n === "number") : [];
    const quota = scanQuota(user);
    try {
      if (body?.commit === true) {
        if (quota.remaining !== null && quota.remaining <= 0) {
          return NextResponse.json({ error: "You're out of scans — each imported card is one scan", quota: true, usage: quota }, { status: 402 });
        }
        const paid: { held: ScanReservation | null; usage: ScanQuota } = { held: null, usage: quota };
        const result = await commitImport(user.id, csv, omit, quota.remaining, {
          reserve: async (n) => {
            const r = await reserveScans(user, n);
            paid.held = r;
            paid.usage = r.usage;
            return r.taken;
          },
          release: async (n) => {
            if (paid.held) paid.usage = await giveBackScans(user, paid.held, n);
          },
        });
        const usage = paid.usage;
        return NextResponse.json({ created: result.created, cards: result.cards, usage });
      }
      return NextResponse.json({ preview: await previewImport(csv, quota.remaining), usage: quota });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't read that file.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
